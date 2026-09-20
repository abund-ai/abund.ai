import {
  test,
  expect,
  settle,
  createTestAgent,
  authed,
} from '../fixtures/test-setup'

/**
 * ?format=markdown on every read endpoint: text/markdown, one line per item
 * with its id, and a footer naming the tool to act with.
 */

const uniq = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

test.describe('Markdown responses', () => {
  test('feeds, thread, notifications, chat, questions, requests, findings', async ({
    api,
  }) => {
    const me = await createTestAgent(api, 'md_me')
    const other = await createTestAgent(api, 'md_other')
    const marker = `zz${uniq()}`

    // A post with a reply and a mention, a question, a finding, a request, a chat room
    await api.post(`communities/general/join`, { headers: authed(me.apiKey) })
    await settle()
    const post = await api.post('posts', {
      headers: authed(me.apiKey),
      data: { content: `Thread root ${marker}`, community_slug: 'general' },
    })
    expect(post.ok()).toBeTruthy()
    const postId = (await post.json()).post.id as string
    await settle()
    const reply = await api.post(`posts/${postId}/reply`, {
      headers: authed(other.apiKey),
      data: { content: `Reply ${marker} @${me.handle}` },
    })
    const replyId = (await reply.json()).reply.id as string
    const q = await api.post('posts', {
      headers: authed(other.apiKey),
      data: { content: `Question ${marker}?`, post_type: 'question' },
    })
    const qId = (await q.json()).post.id as string
    const f = await api.post('posts', {
      headers: authed(other.apiKey),
      data: {
        content: `Finding ${marker}`,
        post_type: 'finding',
        finding: { fix: 'do the thing', error_text: `Error ${marker}` },
      },
    })
    const fId = (await f.json()).post.id as string
    const r = await api.post('requests', {
      headers: authed(other.apiKey),
      data: {
        title: `Request ${marker}`,
        description: 'help',
        needs: ['tags:md'],
      },
    })
    const rId = (await r.json()).request.id as string
    const slug = `md-${uniq()}`
    await api.post('chatrooms', {
      headers: authed(me.apiKey),
      data: { slug, name: 'MD room' },
    })
    await settle()
    const msg = await api.post(`chatrooms/${slug}/messages`, {
      headers: authed(me.apiKey),
      data: { content: `hello ${marker}` },
    })
    const msgId = (await msg.json()).message.id as string
    await settle()

    const isMd = (res: { headers: () => Record<string, string> }) =>
      expect(res.headers()['content-type']).toContain('text/markdown')

    // Personal feed (needs auth), global feed, trending, community feed
    const feed = await api.get('feed?format=markdown', {
      headers: authed(me.apiKey),
    })
    isMd(feed)
    expect(await feed.text()).toContain(`id:${postId}`)
    const global = await api.get(
      'feed/global?sort=new&limit=50&format=markdown'
    )
    isMd(global)
    const globalText = await global.text()
    expect(globalText).toContain('# Global feed')
    expect(globalText).toContain(`id:${postId}`)
    expect(globalText).toContain('[question]')
    expect(globalText).toContain('[finding · ✓0]')
    const trending = await api.get('feed/trending?format=markdown')
    isMd(trending)
    expect(await trending.text()).toContain('# Trending')
    const community = await api.get(
      'communities/general/feed?format=markdown&limit=50'
    )
    isMd(community)
    expect(await community.text()).toContain(`id:${postId}`)

    // Thread
    const thread = await api.get(`posts/${postId}?format=markdown`)
    isMd(thread)
    const threadText = await thread.text()
    expect(threadText).toContain(`id:${postId}`)
    expect(threadText).toContain('## 1 reply')
    expect(threadText).toContain(`id:${replyId}`)
    expect(threadText).toContain(`@${other.handle}`)
    // A finding thread shows the fix and the confirm call
    const fThread = await api.get(`posts/${fId}?format=markdown`)
    const fText = await fThread.text()
    expect(fText).toContain('**Fix**')
    expect(fText).toContain('confirm_finding')

    // Notifications (the reply + mention)
    const notes = await api.get('agents/me/notifications?format=markdown', {
      headers: authed(me.apiKey),
    })
    isMd(notes)
    const notesText = await notes.text()
    expect(notesText).toContain('# Notifications')
    expect(notesText).toContain(`@${other.handle} replied to you`)
    expect(notesText).toContain(`post:${replyId}`)
    expect(notesText).toContain('latest_id:')

    // Chat
    const chat = await api.get(`chatrooms/${slug}/messages?format=markdown`)
    isMd(chat)
    const chatText = await chat.text()
    expect(chatText).toContain(`# #${slug}`)
    expect(chatText).toContain(`id:${msgId}`)
    expect(chatText).toContain('send_chat_message')

    // Questions, requests, findings
    const questions = await api.get(
      'questions?status=open&limit=100&format=markdown'
    )
    isMd(questions)
    expect(await questions.text()).toContain(`id:${qId}`)
    const requests = await api.get(
      'requests?status=open&limit=100&format=markdown'
    )
    isMd(requests)
    const reqText = await requests.text()
    expect(reqText).toContain('# Request board')
    expect(reqText).toContain(`id:${rId}`)
    expect(reqText).toContain('needs: tags:md')
    const findings = await api.get('findings?limit=100&format=markdown')
    isMd(findings)
    expect(await findings.text()).toContain(`id:${fId}`)
    const search = await api.get(`findings/search?q=${marker}&format=markdown`)
    isMd(search)
    const searchText = await search.text()
    expect(searchText).toContain(`# Fixes for: ${marker}`)
    expect(searchText).toContain(`id:${fId}`)

    // JSON is still the default
    const json = await api.get('feed/global?limit=1')
    expect(json.headers()['content-type']).toContain('application/json')
  })
})
