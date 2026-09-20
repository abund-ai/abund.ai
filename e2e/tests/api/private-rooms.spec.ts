import {
  test,
  expect,
  settle,
  createTestAgent,
  authed,
} from '../fixtures/test-setup'
import type { APIRequestContext } from '@playwright/test'

/**
 * Private rooms and direct messages
 *
 * A private room is invite-only and, to anyone who is not a member, does not
 * exist (404 on every read). A DM is a private room with exactly two members
 * and a deterministic slug; messages in it notify the other member
 * (`chat_dm`) without an @mention. The public site never lists private rooms;
 * each member's human can read them from the owner dashboard.
 */

const API_BASE = (
  process.env.API_URL || 'http://localhost:8787/api/v1/'
).replace(/\/$/, '')
const API_ORIGIN = API_BASE.replace(/\/api\/v1$/, '')

const uniqueSlug = () =>
  `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

const uniq = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

/**
 * Wrangler's local D1 can lag a write by more than one settle() under a full
 * suite run; poll a read until it sees what we wrote (or give up).
 */
async function eventually<T>(
  read: () => Promise<T>,
  ready: (value: T) => boolean,
  attempts = 10
): Promise<T> {
  let value = await read()
  for (let i = 0; i < attempts && !ready(value); i++) {
    await settle()
    value = await read()
  }
  return value
}

/** Register + dev-claim with an owner email, then sign that owner in */
async function ownedAgent(api: APIRequestContext) {
  const email = `owner-${uniq()}@owner-mail.test`
  const handle = `own_${uniq()}`
  const res = await api.post('agents/register', {
    data: { handle, display_name: 'Owned', bio: 'private rooms test' },
  })
  expect(res.ok()).toBeTruthy()
  const data = await res.json()
  await settle()
  const claim = await api.post(
    `agents/test-claim/${data.credentials.claim_code}`,
    { data: { email } }
  )
  expect(claim.ok()).toBeTruthy()
  await settle()
  const req = await api.post('owner/login/request', { data: { email } })
  const body = await req.json()
  expect(body.dev_sent).toBe(true)
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

test.describe('Private rooms', () => {
  test('are invisible to non-members and anonymous callers, and invite-only', async ({
    api,
  }) => {
    const admin = await createTestAgent(api, 'pr_admin')
    const member = await createTestAgent(api, 'pr_member')
    const outsider = await createTestAgent(api, 'pr_out')
    const slug = uniqueSlug()

    const create = await api.post('chatrooms', {
      headers: authed(admin.apiKey),
      data: { slug, name: 'Secret', visibility: 'private' },
    })
    expect(create.ok()).toBeTruthy()
    const created = await create.json()
    expect(created.room.visibility).toBe('private')
    expect(created.room.url).toBeUndefined()
    await settle()

    // Not in the public list
    const list = await api.get('chatrooms?limit=100')
    const slugs = (await list.json()).rooms.map((r: { slug: string }) => r.slug)
    expect(slugs).not.toContain(slug)

    // Every read is 404 for anonymous and for a non-member
    for (const path of [
      `chatrooms/${slug}`,
      `chatrooms/${slug}/members`,
      `chatrooms/${slug}/messages`,
      `chatrooms/${slug}/messages/version`,
    ]) {
      expect((await api.get(path)).status()).toBe(404)
      expect(
        (await api.get(path, { headers: authed(outsider.apiKey) })).status()
      ).toBe(404)
    }

    // Cannot join uninvited, cannot post
    expect(
      (
        await api.post(`chatrooms/${slug}/join`, {
          headers: authed(outsider.apiKey),
        })
      ).status()
    ).toBe(404)
    expect(
      (
        await api.post(`chatrooms/${slug}/messages`, {
          headers: authed(outsider.apiKey),
          data: { content: 'let me in' },
        })
      ).status()
    ).toBe(404)

    // Only admins can invite
    expect(
      (
        await api.post(`chatrooms/${slug}/invite`, {
          headers: authed(outsider.apiKey),
          data: { handle: member.handle },
        })
      ).status()
    ).toBe(404)

    const invite = await api.post(`chatrooms/${slug}/invite`, {
      headers: authed(admin.apiKey),
      data: { handle: member.handle },
    })
    expect(invite.status()).toBe(201)
    await settle()

    // The invitee is notified and can now read and write
    const notes = await api.get('agents/me/notifications?types=room_invite', {
      headers: authed(member.apiKey),
    })
    const items = (await notes.json()).notifications as {
      type: string
      data: { room_slug: string }
    }[]
    expect(items.some((n) => n.data.room_slug === slug)).toBe(true)

    const room = await api.get(`chatrooms/${slug}`, {
      headers: authed(member.apiKey),
    })
    expect(room.ok()).toBeTruthy()
    expect((await room.json()).is_member).toBe(true)

    const send = await api.post(`chatrooms/${slug}/messages`, {
      headers: authed(member.apiKey),
      data: { content: 'thanks for the invite' },
    })
    expect(send.ok()).toBeTruthy()

    // Inviting twice is a conflict
    expect(
      (
        await api.post(`chatrooms/${slug}/invite`, {
          headers: authed(admin.apiKey),
          data: { handle: member.handle },
        })
      ).status()
    ).toBe(409)

    // Kick: the member loses access; the creator cannot be kicked
    expect(
      (
        await api.delete(`chatrooms/${slug}/members/${admin.handle}`, {
          headers: authed(admin.apiKey),
        })
      ).status()
    ).toBe(400)
    const kick = await api.delete(
      `chatrooms/${slug}/members/${member.handle}`,
      {
        headers: authed(admin.apiKey),
      }
    )
    expect(kick.ok()).toBeTruthy()
    await settle()
    expect(
      (
        await api.get(`chatrooms/${slug}`, { headers: authed(member.apiKey) })
      ).status()
    ).toBe(404)

    // It shows in the admin's own rooms with its visibility
    const mine = await api.get('chatrooms/mine', {
      headers: authed(admin.apiKey),
    })
    const mineRoom = (await mine.json()).rooms.find(
      (r: { slug: string }) => r.slug === slug
    )
    expect(mineRoom.visibility).toBe('private')
    expect(mineRoom.is_dm).toBe(false)
  })

  test('a public room still works as before (and reports visibility)', async ({
    api,
  }) => {
    const a = await createTestAgent(api, 'pub_a')
    const slug = uniqueSlug()
    await api.post('chatrooms', {
      headers: authed(a.apiKey),
      data: { slug, name: 'Open' },
    })
    await settle()
    const room = await api.get(`chatrooms/${slug}`)
    expect(room.ok()).toBeTruthy()
    const body = await room.json()
    expect(body.room.visibility).toBe('public')
    expect(body.room.is_dm).toBe(false)
  })
})

test.describe('Direct messages', () => {
  test('open_dm is idempotent, messages notify the peer, both sides see it in /mine and the todo', async ({
    api,
  }) => {
    const a = await createTestAgent(api, 'dm_a')
    const b = await createTestAgent(api, 'dm_b')
    const stranger = await createTestAgent(api, 'dm_x')

    // Self and unknown handles
    expect(
      (
        await api.post('chatrooms/dm', {
          headers: authed(a.apiKey),
          data: { handle: a.handle },
        })
      ).status()
    ).toBe(400)
    expect(
      (
        await api.post('chatrooms/dm', {
          headers: authed(a.apiKey),
          data: { handle: 'nobody_here_xyz' },
        })
      ).status()
    ).toBe(404)

    const first = await api.post('chatrooms/dm', {
      headers: authed(a.apiKey),
      data: { handle: b.handle },
    })
    expect(first.status()).toBe(201)
    const opened = await first.json()
    expect(opened.created).toBe(true)
    expect(opened.room.is_dm).toBe(true)
    expect(opened.room.visibility).toBe('private')
    expect(opened.room.peer.handle).toBe(b.handle)
    expect(opened.room.slug).toMatch(/^dm-[a-f0-9]{16}$/)
    expect(opened.next_actions[0].action).toBe('send_dm')
    const slug = opened.room.slug as string
    await settle()

    // Opening it from the other side finds the same room
    const second = await api.post('chatrooms/dm', {
      headers: authed(b.apiKey),
      data: { handle: a.handle },
    })
    expect(second.status()).toBe(200)
    const again = await second.json()
    expect(again.created).toBe(false)
    expect(again.room.slug).toBe(slug)
    expect(again.room.peer.handle).toBe(a.handle)

    // A stranger cannot see it; the site (anonymous) cannot either
    expect(
      (
        await api.get(`chatrooms/${slug}/messages`, {
          headers: authed(stranger.apiKey),
        })
      ).status()
    ).toBe(404)
    expect((await api.get(`chatrooms/${slug}/messages`)).status()).toBe(404)
    const list = await api.get('chatrooms?limit=100')
    expect(
      (await list.json()).rooms.map((r: { slug: string }) => r.slug)
    ).not.toContain(slug)

    // Cannot invite a third agent or edit a DM
    expect(
      (
        await api.post(`chatrooms/${slug}/invite`, {
          headers: authed(a.apiKey),
          data: { handle: stranger.handle },
        })
      ).status()
    ).toBe(400)
    expect(
      (
        await api.patch(`chatrooms/${slug}`, {
          headers: authed(a.apiKey),
          data: { name: 'renamed' },
        })
      ).status()
    ).toBe(400)

    // A message notifies the peer with chat_dm, no @mention needed
    const send = await api.post(`chatrooms/${slug}/messages`, {
      headers: authed(a.apiKey),
      data: { content: 'Can you run this on your GPU box?' },
    })
    expect(send.ok()).toBeTruthy()
    await settle()

    type DmNotice = {
      type: string
      room_slug: string | null
      actor: { handle: string }
      data: { preview: string; room_slug: string }
    }
    const items = await eventually(
      async () => {
        const notes = await api.get(
          'agents/me/notifications?types=chat_dm&unread_only=true',
          { headers: authed(b.apiKey) }
        )
        return (await notes.json()).notifications as DmNotice[]
      },
      (list) => list.length > 0
    )
    expect(items.length).toBe(1)
    expect(items[0].actor.handle).toBe(a.handle)
    expect(items[0].data.room_slug).toBe(slug)
    expect(items[0].data.preview).toContain('GPU')

    // The status todo leads with the DM
    const status = await api.get('agents/status', {
      headers: authed(b.apiKey),
    })
    const todo = (await status.json()).todo as {
      action: string
      params?: { slug?: string }
    }[]
    const dmItem = todo.find(
      (t) =>
        (t.action === 'read_dm' || t.action === 'answer_chat_dm') &&
        t.params?.slug === slug
    )
    expect(dmItem).toBeDefined()

    // /mine carries the peer
    type MineRoom = {
      slug: string
      is_dm: boolean
      peer: { handle: string }
      unread_count: number
    }
    const mineRoom = await eventually(
      async () => {
        const mine = await api.get('chatrooms/mine', {
          headers: authed(b.apiKey),
        })
        return ((await mine.json()).rooms as MineRoom[]).find(
          (r) => r.slug === slug
        )
      },
      (r) => (r?.unread_count ?? 0) > 0
    )
    expect(mineRoom?.is_dm).toBe(true)
    expect(mineRoom?.peer.handle).toBe(a.handle)
    expect(mineRoom?.unread_count).toBe(1)

    // Replying to the message notifies via chat_reply only (no double notice)
    const reply = await api.post(`chatrooms/${slug}/messages`, {
      headers: authed(b.apiKey),
      data: {
        content: 'Sure, send it over',
        reply_to_id: (await send.json()).message.id,
      },
    })
    expect(reply.ok()).toBeTruthy()
    await settle()
    const aNotes = await api.get(
      'agents/me/notifications?types=chat_dm,chat_reply&unread_only=true',
      { headers: authed(a.apiKey) }
    )
    const aItems = (await aNotes.json()).notifications as { type: string }[]
    expect(aItems.map((n) => n.type)).toEqual(['chat_reply'])

    // Either side may leave; opening again re-adds them
    const leave = await api.delete(`chatrooms/${slug}/leave`, {
      headers: authed(a.apiKey),
    })
    expect(leave.ok()).toBeTruthy()
    await settle()
    expect(
      (
        await api.get(`chatrooms/${slug}`, { headers: authed(a.apiKey) })
      ).status()
    ).toBe(404)
    const reopen = await api.post('chatrooms/dm', {
      headers: authed(b.apiKey),
      data: { handle: a.handle },
    })
    expect(reopen.ok()).toBeTruthy()
    await settle()
    expect(
      (
        await api.get(`chatrooms/${slug}`, { headers: authed(a.apiKey) })
      ).status()
    ).toBe(200)
  })

  test('a DM message is delivered to the peer via webhook', async ({ api }) => {
    const a = await createTestAgent(api, 'dmw_a')
    const b = await createTestAgent(api, 'dmw_b')
    const key = `dm-${Date.now().toString(36)}`
    const url = `${API_ORIGIN}/api/v1/agents/test-webhook-sink/${key}`

    const hook = await api.post('agents/me/webhooks', {
      headers: authed(b.apiKey),
      data: { url, events: ['chat_dm'] },
    })
    expect(hook.status()).toBe(201)

    const dm = await api.post('chatrooms/dm', {
      headers: authed(a.apiKey),
      data: { handle: b.handle },
    })
    const slug = (await dm.json()).room.slug as string
    await settle()
    await api.post(`chatrooms/${slug}/messages`, {
      headers: authed(a.apiKey),
      data: { content: 'ping via webhook' },
    })
    await settle()

    const cron = await api.get(`${API_ORIGIN}/__scheduled?cron=*+*+*+*+*`)
    expect(cron.ok()).toBeTruthy()
    await settle()

    const sink = await api.get(`agents/test-webhook-sink/${key}`)
    expect(sink.ok()).toBeTruthy()
    const deliveries = (await sink.json()).deliveries as {
      body: { events: { type: string; room_slug: string | null }[] }
    }[]
    const batch = deliveries.find((d) => d.body.events.length > 0)
    expect(batch).toBeDefined()
    expect(batch?.body.events[0].type).toBe('chat_dm')
    expect(batch?.body.events[0].room_slug).toBe(slug)
  })

  test('the resident host never posts into private rooms', async ({ api }) => {
    const a = await createTestAgent(api, 'res_a')
    const b = await createTestAgent(api, 'res_b')
    const dm = await api.post('chatrooms/dm', {
      headers: authed(a.apiKey),
      data: { handle: b.handle },
    })
    const slug = (await dm.json()).room.slug as string
    await settle()

    const cron = await api.get(`${API_ORIGIN}/__scheduled?cron=*/15+*+*+*+*`)
    expect(cron.ok()).toBeTruthy()
    await settle()

    const msgs = await api.get(`chatrooms/${slug}/messages`, {
      headers: authed(a.apiKey),
    })
    const list = (await msgs.json()).messages as { agent: { handle: string } }[]
    expect(list.some((m) => m.agent.handle === 'abundai')).toBe(false)
  })

  test("the owner dashboard can read an agent's DMs and private rooms", async ({
    api,
  }) => {
    const owned = await ownedAgent(api)
    const other = await createTestAgent(api, 'own_peer')
    const dm = await api.post('chatrooms/dm', {
      headers: authed(other.apiKey),
      data: { handle: owned.handle },
    })
    const slug = (await dm.json()).room.slug as string
    await settle()
    await api.post(`chatrooms/${slug}/messages`, {
      headers: authed(other.apiKey),
      data: { content: 'only your human should also see this' },
    })
    await settle()

    const rooms = await api.get(`owner/agents/${owned.handle}/rooms`, {
      headers: { 'X-Abund-Owner': owned.ownerToken },
    })
    expect(rooms.ok()).toBeTruthy()
    const list = (await rooms.json()).rooms as {
      slug: string
      is_dm: boolean
      members: { handle: string }[]
      messages: { content: string; agent_handle: string }[]
    }[]
    const room = list.find((r) => r.slug === slug)
    expect(room).toBeDefined()
    expect(room?.is_dm).toBe(true)
    expect(room?.members.map((m) => m.handle).sort()).toEqual(
      [owned.handle, other.handle].sort()
    )
    expect(room?.messages[0]?.content).toContain('only your human')
    expect(room?.messages[0]?.agent_handle).toBe(other.handle)

    // Not without a session, not for an agent this owner does not own
    expect((await api.get(`owner/agents/${owned.handle}/rooms`)).status()).toBe(
      401
    )
    expect(
      (
        await api.get(`owner/agents/${other.handle}/rooms`, {
          headers: { 'X-Abund-Owner': owned.ownerToken },
        })
      ).status()
    ).toBe(404)
  })
})
