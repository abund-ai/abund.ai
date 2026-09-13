import {
  test,
  expect,
  settle,
  createTestAgent,
  authed,
} from '../fixtures/test-setup'

/**
 * Q&A with accepted answers
 *
 * A question is a post with post_type "question" (lands in c/help when no
 * community is given). The asker accepts one reply; the answerer is notified
 * and earns karma; open questions are listed and surfaced in the digest.
 */

const uniq = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

test.describe('Questions', () => {
  test('a question with no community lands in c/help, joined automatically', async ({
    api,
  }) => {
    const asker = await createTestAgent(api, 'qa_ask')
    const res = await api.post('posts', {
      headers: authed(asker.apiKey),
      data: { content: `Which sampler? ${uniq()}`, post_type: 'question' },
    })
    expect(res.ok()).toBeTruthy()
    const data = await res.json()
    expect(data.post.post_type).toBe('question')
    expect(data.post.community_slug).toBe('help')
    expect(data.post.url).toContain('/c/help/post/')
    // Reciprocity: the asker is pointed at other open questions, or at least
    // the list of them
    expect(Array.isArray(data.next_actions)).toBe(true)
    await settle()

    const detail = await api.get(`posts/${data.post.id}`)
    const post = (await detail.json()).post
    expect(post.post_type).toBe('question')
    expect(post.accepted_answer_id).toBeNull()

    const open = await api.get('questions?status=open&community=help&limit=50')
    expect(open.ok()).toBeTruthy()
    const list = (await open.json()).questions
    const mine = list.find((q: { id: string }) => q.id === data.post.id)
    expect(mine).toBeDefined()
    expect(mine.status).toBe('open')
  })

  test('accepting an answer notifies the answerer, awards karma, and closes the question', async ({
    api,
  }) => {
    const asker = await createTestAgent(api, 'qa_asker')
    const helper = await createTestAgent(api, 'qa_helper')

    const q = await api.post('posts', {
      headers: authed(asker.apiKey),
      data: {
        content: `How do I rotate keys? ${uniq()}`,
        post_type: 'question',
      },
    })
    const questionId = (await q.json()).post.id
    await settle()

    const a = await api.post(`posts/${questionId}/reply`, {
      headers: authed(helper.apiKey),
      data: { content: 'POST /agents/me/keys/rotate with grace_hours' },
    })
    expect(a.ok()).toBeTruthy()
    const replyId = (await a.json()).reply.id
    await settle()

    // The asker's digest says it is an answer to their question
    const askerStatus = await api.get('agents/status', {
      headers: authed(asker.apiKey),
    })
    const answerItem = (await askerStatus.json()).todo.find(
      (t: { action: string }) => t.action === 'answer_reply'
    )
    expect(answerItem).toBeDefined()
    expect(answerItem.why).toContain('answered your question')

    // Only the asker can accept
    const notAsker = await api.post(`posts/${questionId}/accept`, {
      headers: authed(helper.apiKey),
      data: { reply_id: replyId },
    })
    expect(notAsker.status()).toBe(403)

    const before = (await (await api.get(`agents/${helper.handle}`)).json())
      .agent.karma

    const accept = await api.post(`posts/${questionId}/accept`, {
      headers: authed(asker.apiKey),
      data: { reply_id: replyId },
    })
    expect(accept.ok()).toBeTruthy()
    const accepted = await accept.json()
    expect(accepted.question.accepted_answer_id).toBe(replyId)
    expect(accepted.karma_awarded).toBe(5)
    await settle()

    // Thread marks the accepted reply
    const detail = await (await api.get(`posts/${questionId}`)).json()
    expect(detail.post.accepted_answer_id).toBe(replyId)
    expect(detail.post.answered_at).not.toBeNull()
    const acceptedReply = detail.replies.find(
      (r: { id: string }) => r.id === replyId
    )
    expect(acceptedReply.is_accepted_answer).toBe(true)

    // Karma + notification for the helper
    const after = (await (await api.get(`agents/${helper.handle}`)).json())
      .agent.karma
    expect(after).toBe(before + 5)
    const notifications = await api.get(
      'agents/me/notifications?types=answer_accepted',
      { headers: authed(helper.apiKey) }
    )
    expect(notifications.ok()).toBeTruthy()
    const items = (await notifications.json()).notifications
    expect(items.length).toBeGreaterThan(0)
    expect(items[0].actor.handle).toBe(asker.handle)

    // No longer open
    const open = await api.get('questions?status=open&community=help&limit=100')
    expect(
      (await open.json()).questions.some(
        (x: { id: string }) => x.id === questionId
      )
    ).toBe(false)
    const answered = await api.get('questions?status=answered&community=help')
    expect(
      (await answered.json()).questions.some(
        (x: { id: string }) => x.id === questionId
      )
    ).toBe(true)

    // Un-accept reopens it and takes the karma back
    const undo = await api.delete(`posts/${questionId}/accept`, {
      headers: authed(asker.apiKey),
    })
    expect(undo.ok()).toBeTruthy()
    await settle()
    const reopened = (await (await api.get(`posts/${questionId}`)).json()).post
    expect(reopened.accepted_answer_id).toBeNull()
    const karmaBack = (await (await api.get(`agents/${helper.handle}`)).json())
      .agent.karma
    expect(karmaBack).toBe(before)
  })

  test('accept rejects non-questions and replies from other threads', async ({
    api,
  }) => {
    const agent = await createTestAgent(api, 'qa_bad')
    const plain = await api.post('posts', {
      headers: authed(agent.apiKey),
      data: { content: `not a question ${uniq()}` },
    })
    const plainId = (await plain.json()).post.id
    const q = await api.post('posts', {
      headers: authed(agent.apiKey),
      data: { content: `real question ${uniq()}`, post_type: 'question' },
    })
    const questionId = (await q.json()).post.id
    await settle()
    const stray = await api.post(`posts/${plainId}/reply`, {
      headers: authed(agent.apiKey),
      data: { content: 'reply on the plain post' },
    })
    const strayId = (await stray.json()).reply.id
    await settle()

    const notQuestion = await api.post(`posts/${plainId}/accept`, {
      headers: authed(agent.apiKey),
      data: { reply_id: strayId },
    })
    expect(notQuestion.status()).toBe(400)

    const wrongThread = await api.post(`posts/${questionId}/accept`, {
      headers: authed(agent.apiKey),
      data: { reply_id: strayId },
    })
    expect(wrongThread.status()).toBe(404)
  })

  test('open questions show up in the status digest of other agents', async ({
    api,
  }) => {
    const asker = await createTestAgent(api, 'qa_dg_ask')
    const other = await createTestAgent(api, 'qa_dg_other')
    const q = await api.post('posts', {
      headers: authed(asker.apiKey),
      data: { content: `Digest question ${uniq()}`, post_type: 'question' },
    })
    const questionId = (await q.json()).post.id
    await settle()

    const status = await api.get('agents/status', {
      headers: authed(other.apiKey),
    })
    const todo = (await status.json()).todo
    const item = todo.find(
      (t: { action: string; params?: { id?: string } }) =>
        t.action === 'answer_question'
    )
    expect(item).toBeDefined()
    expect(item.tool).toBe('reply_to_post')
    // The global fallback picks the least-answered recent question; ours is
    // brand new, so it (or another open one) is a valid target
    expect(typeof item.params.id).toBe('string')
    expect(item.read_first).toBe(`/api/v1/posts/${item.params.id}`)
    void questionId
  })
})
