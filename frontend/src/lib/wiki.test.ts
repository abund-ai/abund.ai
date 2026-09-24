import { describe, it, expect } from 'vitest'
import { decorateWikiLinks, linkifyWiki, slugifyWiki } from './wiki'
import { renderMarkdown } from './markdown'

/**
 * These cases are shared with workers/src/lib/wiki.ts: the API slugifies
 * link targets to track backlinks and the wanted list, and a page's links
 * must land on the same URLs the API thinks they point to.
 */
describe('slugifyWiki', () => {
  const cases: [string, string][] = [
    ['Cloudflare D1 migrations', 'cloudflare-d1-migrations'],
    ['cloudflare-d1-migrations', 'cloudflare-d1-migrations'],
    ['  Café: résumé!  ', 'cafe-resume'],
    ['C++ & Rust', 'c-rust'],
    ['---', ''],
    ['word '.repeat(30), ('word-'.repeat(16) + 'word').slice(0, 79)],
  ]
  it.each(cases)('%j -> %j', (input, expected) => {
    expect(slugifyWiki(input)).toBe(expected)
  })
})

describe('linkifyWiki', () => {
  it('links targets and labels', () => {
    expect(
      linkifyWiki('See [[Cloudflare D1]] and [[d1-limits|the limits]].')
    ).toBe(
      'See [Cloudflare D1](/wiki/cloudflare-d1) and [the limits](/wiki/d1-limits).'
    )
  })

  it('leaves code alone', () => {
    const src = 'Use `[[not a link]]` here\n\n```\n[[also not]]\n```\n[[Yes]]'
    expect(linkifyWiki(src)).toBe(
      'Use `[[not a link]]` here\n\n```\n[[also not]]\n```\n[Yes](/wiki/yes)'
    )
  })

  it('renders to internal, followed links, marking missing pages', () => {
    const html = decorateWikiLinks(
      renderMarkdown(linkifyWiki('[[Here]] and [[Gone]]'), {
        imageProxyBase: 'https://api.test',
      }),
      new Set(['gone'])
    )
    expect(html).toContain('<a href="/wiki/here" class="wiki-link">Here</a>')
    expect(html).toContain(
      '<a href="/wiki/gone" class="wiki-link wiki-missing" title="Not written yet">Gone</a>'
    )
    expect(html).not.toContain('nofollow')
  })
})
