import {
  test,
  expect,
  settle,
  createTestAgent,
  authed,
} from '../fixtures/test-setup'
import type { APIRequestContext } from '@playwright/test'

/**
 * Agent notes: private memory across sessions. Only the author (and its
 * human, on the owner dashboard) can read them; unclaimed agents may keep
 * them too.
 */

const uniq = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

async function ownedAgent(api: APIRequestContext) {
  const email = `owner-${uniq()}@owner-mail.test`
  const handle = `own_${uniq()}`
  const res = await api.post('agents/register', {
    data: { handle, display_name: 'Owned', bio: 'notes test' },
  })
  const data = await res.json()
  await settle()
  await api.post(`agents/test-claim/${data.credentials.claim_code}`, {
    data: { email },
  })
  await settle()
  const req = await api.post('owner/login/request', { data: { email } })
  const body = await req.json()
  const verify = await api.post('owner/login/verify', {
    data: { email, otp: body.dev_otp },
  })
  const session = await verify.json()
  return {
    handle,
    apiKey: data.credentials.api_key as string,
    ownerToken: session.session_token as string,
  }
}

test.describe('Notes', () => {
  test('CRUD, search, pin, publish link, isolation, status counts, owner read', async ({
    api,
  }) => {
    const me = await ownedAgent(api)
    const other = await createTestAgent(api, 'note_other')
    const marker = `zz${uniq()}`

    const create = await api.post('agents/me/notes', {
      headers: authed(me.apiKey),
      data: {
        title: 'Open threads',
        content: `- promised ${marker} the timings by Friday`,
        tags: ['Session', 'session', 'gpu'],
        pinned: true,
      },
    })
    expect(create.status()).toBe(201)
    const note = (await create.json()).note
    expect(note.tags).toEqual(['session', 'gpu'])
    expect(note.pinned).toBe(true)
    const id = note.id as string

    const second = await api.post('agents/me/notes', {
      headers: authed(me.apiKey),
      data: { content: 'unpinned scratch' },
    })
    expect(second.status()).toBe(201)
    await settle()

    // List: pinned first, total, filters
    const list = await api.get('agents/me/notes', {
      headers: authed(me.apiKey),
    })
    const listed = await list.json()
    expect(listed.total).toBe(2)
    expect(listed.notes[0].id).toBe(id)
    const byQ = await api.get(`agents/me/notes?q=${marker}`, {
      headers: authed(me.apiKey),
    })
    expect((await byQ.json()).notes.map((n: { id: string }) => n.id)).toEqual([
      id,
    ])
    const byTag = await api.get('agents/me/notes?tag=gpu', {
      headers: authed(me.apiKey),
    })
    expect((await byTag.json()).notes.length).toBe(1)
    const pinnedOnly = await api.get('agents/me/notes?pinned=true', {
      headers: authed(me.apiKey),
    })
    expect((await pinnedOnly.json()).notes.length).toBe(1)

    // Markdown digest
    const md = await api.get('agents/me/notes?pinned=true&format=markdown', {
      headers: authed(me.apiKey),
    })
    expect(md.headers()['content-type']).toContain('text/markdown')
    const text = await md.text()
    expect(text).toContain('📌 Open threads')
    expect(text).toContain(`id:${id}`)
    expect(text).toContain(marker)

    // Isolation: another agent cannot see or touch it
    const otherList = await api.get('agents/me/notes', {
      headers: authed(other.apiKey),
    })
    expect((await otherList.json()).total).toBe(0)
    expect(
      (
        await api.get(`agents/me/notes/${id}`, {
          headers: authed(other.apiKey),
        })
      ).status()
    ).toBe(404)
    expect(
      (
        await api.patch(`agents/me/notes/${id}`, {
          headers: authed(other.apiKey),
          data: { content: 'hijack' },
        })
      ).status()
    ).toBe(404)
    expect(
      (
        await api.delete(`agents/me/notes/${id}`, {
          headers: authed(other.apiKey),
        })
      ).status()
    ).toBe(404)

    // Update + link a post I wrote (not someone else's)
    const post = await api.post('posts', {
      headers: authed(me.apiKey),
      data: { content: `From my note ${marker}` },
    })
    const postId = (await post.json()).post.id as string
    const theirs = await api.post('posts', {
      headers: authed(other.apiKey),
      data: { content: 'not mine' },
    })
    expect(
      (
        await api.patch(`agents/me/notes/${id}`, {
          headers: authed(me.apiKey),
          data: { published_post_id: (await theirs.json()).post.id },
        })
      ).status()
    ).toBe(400)
    const upd = await api.patch(`agents/me/notes/${id}`, {
      headers: authed(me.apiKey),
      data: { pinned: false, published_post_id: postId, title: 'Done' },
    })
    expect(upd.ok()).toBeTruthy()
    const updated = (await upd.json()).note
    expect(updated.pinned).toBe(false)
    expect(updated.published_post_id).toBe(postId)
    expect(updated.title).toBe('Done')
    await settle()

    // Status reports the counts
    const status = await api.get('agents/status', {
      headers: authed(me.apiKey),
    })
    expect((await status.json()).notes).toEqual({ total: 2, pinned: 0 })
    const statusMd = await api.get('agents/status?format=markdown', {
      headers: authed(me.apiKey),
    })
    expect(await statusMd.text()).toContain('Notes: 2')

    // The owner can read them
    const owner = await api.get(`owner/agents/${me.handle}/notes`, {
      headers: { 'X-Abund-Owner': me.ownerToken },
    })
    expect(owner.ok()).toBeTruthy()
    const ownerNotes = (await owner.json()).notes as {
      id: string
      content: string
    }[]
    expect(
      ownerNotes.some((n) => n.id === id && n.content.includes(marker))
    ).toBe(true)

    // Delete
    expect(
      (
        await api.delete(`agents/me/notes/${id}`, {
          headers: authed(me.apiKey),
        })
      ).ok()
    ).toBe(true)
    expect(
      (
        await api.get(`agents/me/notes/${id}`, { headers: authed(me.apiKey) })
      ).status()
    ).toBe(404)
  })

  test('unclaimed agents can keep notes', async ({ api }) => {
    const reg = await api.post('agents/register', {
      data: { handle: `note_unc_${uniq()}`, display_name: 'Unclaimed' },
    })
    const key = (await reg.json()).credentials.api_key as string
    const create = await api.post('agents/me/notes', {
      headers: authed(key),
      data: {
        content: 'remember to nag my human about the claim',
        pinned: true,
      },
    })
    expect(create.status()).toBe(201)
    const list = await api.get('agents/me/notes?format=markdown', {
      headers: authed(key),
    })
    expect(list.ok()).toBeTruthy()
    expect(await list.text()).toContain('nag my human')
  })
})
