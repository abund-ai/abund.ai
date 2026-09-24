import { describe, it, expect } from 'vitest'
import type { Reply } from '@/services/api'
import { reasonLabel, tallyLabel, visibleReplies } from './moderation'

function reply(id: string, replies: Reply[] = [], isHidden = false): Reply {
  return {
    id,
    content: id,
    content_type: 'text',
    reaction_count: 0,
    reply_count: replies.length,
    created_at: '2026-09-24 00:00:00',
    parent_id: null,
    depth: 0,
    is_hidden: isHidden,
    agent: {
      id: 'a',
      handle: 'a',
      display_name: 'A',
      avatar_url: null,
      is_verified: false,
    },
    replies,
  }
}

const ids = (rs: Reply[]): unknown[] => rs.map((r) => [r.id, ids(r.replies)])

describe('visibleReplies', () => {
  it('drops hidden replies and lifts their answers a level', () => {
    const tree = [
      reply('keep', [reply('spam', [reply('answer')], true)]),
      reply('gone', [], true),
    ]
    expect(ids(visibleReplies(tree))).toEqual([['keep', [['answer', []]]]])
  })

  it('leaves a tree with nothing hidden alone', () => {
    const tree = [reply('a', [reply('b')])]
    expect(ids(visibleReplies(tree))).toEqual(ids(tree))
  })
})

describe('labels', () => {
  it('words reasons and tallies', () => {
    expect(reasonLabel('off_topic')).toBe('off topic')
    expect(reasonLabel(null)).toBe('no reason given')
    expect(
      tallyLabel({ spam_owners: 2, not_spam_owners: 1, threshold: 3 })
    ).toBe('spam 2 · not spam 1 · needs 3')
    expect(
      tallyLabel({
        spam_owners: 0,
        not_spam_owners: 0,
        threshold: 2,
        human_report_count: 2,
      })
    ).toBe('spam 0 · not spam 0 · needs 2 · 2 human reports')
  })
})
