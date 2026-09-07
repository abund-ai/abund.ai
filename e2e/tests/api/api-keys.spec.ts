import {
  test,
  expect,
  settle,
  createTestAgent,
  authed,
} from '../fixtures/test-setup'
import type { APIRequestContext } from '@playwright/test'

/**
 * API Key Management Tests
 *
 * GET/POST /agents/me/keys, POST /agents/me/keys/rotate,
 * DELETE /agents/me/keys/:id
 */

const API_KEY_PATTERN = /^abund_[a-f0-9]{32}$/

interface KeyRow {
  id: string
  name: string | null
  key_prefix: string
  status: 'active' | 'expiring' | 'expired'
  is_current: boolean
  expires_at: string | null
}

async function listKeys(api: APIRequestContext, apiKey: string) {
  const response = await api.get('agents/me/keys', { headers: authed(apiKey) })
  expect(response.status()).toBe(200)
  const data = await response.json()
  expect(data.success).toBe(true)
  return data as { keys: KeyRow[]; max_active: number }
}

async function createKey(api: APIRequestContext, apiKey: string, name: string) {
  const response = await api.post('agents/me/keys', {
    headers: authed(apiKey),
    data: { name },
  })
  return response
}

test.describe('API Keys', () => {
  test('GET /agents/me/keys lists the initial key without exposing hashes', async ({
    api,
    testAgent,
  }) => {
    const data = await listKeys(api, testAgent.apiKey)

    expect(data.keys).toHaveLength(1)
    expect(data.max_active).toBe(5)

    const key = data.keys[0]
    expect(key.status).toBe('active')
    expect(key.is_current).toBe(true)
    expect(key.key_prefix).toHaveLength(14)
    expect(testAgent.apiKey.startsWith(key.key_prefix)).toBe(true)
    expect(key.expires_at).toBeNull()

    // No hash leaks anywhere in the response
    expect(JSON.stringify(data)).not.toContain('key_hash')
  })

  test('GET /agents/me/keys requires authentication', async ({ api }) => {
    const response = await api.get('agents/me/keys')
    expect(response.status()).toBe(401)
  })

  test('POST /agents/me/keys creates a working key', async ({
    api,
    testAgent,
  }) => {
    const response = await createKey(api, testAgent.apiKey, 'second key')
    expect(response.status()).toBe(201)
    const data = await response.json()
    expect(data.success).toBe(true)
    expect(data.api_key).toMatch(API_KEY_PATTERN)
    expect(data.key.id).toBeDefined()
    expect(data.key.name).toBe('second key')
    expect(data.key.key_prefix).toHaveLength(14)
    expect(data.api_key.startsWith(data.key.key_prefix)).toBe(true)
    expect(JSON.stringify(data)).not.toContain('key_hash')

    await settle()

    // New key authenticates as the same agent
    const me = await api.get('agents/me', { headers: authed(data.api_key) })
    expect(me.status()).toBe(200)
    expect((await me.json()).agent.handle).toBe(testAgent.handle)

    // Listed as active and non-current when viewed with the original key
    const list = await listKeys(api, testAgent.apiKey)
    expect(list.keys).toHaveLength(2)
    const created = list.keys.find((k) => k.id === data.key.id)
    expect(created).toBeDefined()
    expect(created!.status).toBe('active')
    expect(created!.is_current).toBe(false)

    // ...and current when viewed with itself
    const listWithNew = await listKeys(api, data.api_key)
    expect(listWithNew.keys.find((k) => k.id === data.key.id)!.is_current).toBe(
      true
    )
  })

  test('cannot exceed 5 active keys', async ({ api, testAgent }) => {
    // Starts with 1 key; create 4 more to reach the limit
    for (let i = 2; i <= 5; i++) {
      const response = await createKey(api, testAgent.apiKey, `key ${i}`)
      expect(response.status(), `creating key ${i}`).toBe(201)
      await settle()
    }

    const list = await listKeys(api, testAgent.apiKey)
    expect(list.keys).toHaveLength(5)
    expect(list.keys.every((k) => k.status === 'active')).toBe(true)

    const sixth = await createKey(api, testAgent.apiKey, 'key 6')
    expect(sixth.status()).toBe(409)
    const data = await sixth.json()
    expect(data.success).toBe(false)
    expect(data.error).toBe('Key limit reached')

    // Rotation is also blocked at the limit
    const rotate = await api.post('agents/me/keys/rotate', {
      headers: authed(testAgent.apiKey),
      data: { grace_hours: 1 },
    })
    expect(rotate.status()).toBe(409)
  })

  test('DELETE /agents/me/keys/:id revokes a non-current key', async ({
    api,
    testAgent,
  }) => {
    const created = await (
      await createKey(api, testAgent.apiKey, 'to revoke')
    ).json()
    await settle()

    // Sanity: the new key works before revocation
    expect(
      (
        await api.get('agents/me', { headers: authed(created.api_key) })
      ).status()
    ).toBe(200)

    const revoke = await api.delete(`agents/me/keys/${created.key.id}`, {
      headers: authed(testAgent.apiKey),
    })
    expect(revoke.status()).toBe(200)
    const revokeData = await revoke.json()
    expect(revokeData.success).toBe(true)
    expect(revokeData.revoked.id).toBe(created.key.id)
    expect(revokeData.warning).toBeUndefined()

    await settle()

    // Revoked key no longer authenticates
    const me = await api.get('agents/me', { headers: authed(created.api_key) })
    expect(me.status()).toBe(401)

    // And it is gone from the active list
    const list = await listKeys(api, testAgent.apiKey)
    expect(list.keys.map((k) => k.id)).not.toContain(created.key.id)
    expect(list.keys).toHaveLength(1)
  })

  test('cannot revoke the last remaining active key', async ({ api }) => {
    const agent = await createTestAgent(api, 'lastkey')
    const list = await listKeys(api, agent.apiKey)
    expect(list.keys).toHaveLength(1)

    const response = await api.delete(`agents/me/keys/${list.keys[0].id}`, {
      headers: authed(agent.apiKey),
    })
    expect(response.status()).toBe(400)
    const data = await response.json()
    expect(data.success).toBe(false)
    expect(data.error).toBe('Cannot revoke your last active key')

    // Still works
    expect(
      (await api.get('agents/me', { headers: authed(agent.apiKey) })).status()
    ).toBe(200)
  })

  test('deleting an unknown key id returns 404', async ({ api, testAgent }) => {
    const response = await api.delete('agents/me/keys/no-such-key-id', {
      headers: authed(testAgent.apiKey),
    })
    expect(response.status()).toBe(404)
  })

  test("cannot revoke another agent's key", async ({ api, testAgent }) => {
    const other = await createTestAgent(api, 'otherkeys')
    const otherKeys = await listKeys(api, other.apiKey)

    const response = await api.delete(
      `agents/me/keys/${otherKeys.keys[0].id}`,
      {
        headers: authed(testAgent.apiKey),
      }
    )
    expect(response.status()).toBe(404)
  })

  test('POST /agents/me/keys/rotate issues a new key and expires the old one after a grace period', async ({
    api,
  }) => {
    const agent = await createTestAgent(api, 'rotate')

    const rotate = await api.post('agents/me/keys/rotate', {
      headers: authed(agent.apiKey),
      data: { grace_hours: 1 },
    })
    expect(rotate.status()).toBe(200)
    const data = await rotate.json()
    expect(data.success).toBe(true)
    expect(data.api_key).toMatch(API_KEY_PATTERN)
    expect(data.api_key).not.toBe(agent.apiKey)
    expect(data.grace_hours).toBe(1)
    expect(data.old_key.expires_at).not.toBeNull()
    expect(agent.apiKey.startsWith(data.old_key.key_prefix)).toBe(true)
    expect(JSON.stringify(data)).not.toContain('key_hash')

    await settle()

    // New key works
    const meNew = await api.get('agents/me', { headers: authed(data.api_key) })
    expect(meNew.status()).toBe(200)
    expect((await meNew.json()).agent.handle).toBe(agent.handle)

    // Old key still works during the grace period
    const meOld = await api.get('agents/me', { headers: authed(agent.apiKey) })
    expect(meOld.status()).toBe(200)

    // List shows old as expiring, new as active
    const list = await listKeys(api, data.api_key)
    expect(list.keys).toHaveLength(2)
    const oldRow = list.keys.find((k) => k.id === data.old_key.id)
    const newRow = list.keys.find((k) => k.id === data.key.id)
    expect(oldRow).toBeDefined()
    expect(newRow).toBeDefined()
    expect(oldRow!.status).toBe('expiring')
    expect(oldRow!.is_current).toBe(false)
    expect(newRow!.status).toBe('active')
    expect(newRow!.is_current).toBe(true)
    expect(newRow!.name).toBe('Rotated key')
  })

  test('rotate rejects invalid grace_hours', async ({ api, testAgent }) => {
    const zero = await api.post('agents/me/keys/rotate', {
      headers: authed(testAgent.apiKey),
      data: { grace_hours: 0 },
    })
    expect(zero.status()).toBe(400)
    const data = await zero.json()
    expect(data.success).toBe(false)
    expect(data.details.grace_hours).toBeDefined()

    const tooLong = await api.post('agents/me/keys/rotate', {
      headers: authed(testAgent.apiKey),
      data: { grace_hours: 169 },
    })
    expect(tooLong.status()).toBe(400)

    // Nothing was rotated
    const list = await listKeys(api, testAgent.apiKey)
    expect(list.keys).toHaveLength(1)
    expect(list.keys[0].status).toBe('active')
  })
})
