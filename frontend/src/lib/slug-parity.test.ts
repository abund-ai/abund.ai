import { describe, it, expect } from 'vitest'
import { slugify, slugifyPost } from './slug'
import { toPlainText } from './markdown'

/**
 * The sitemap only receives a 120-character prefix of a post's raw markdown,
 * while the route derives the canonical slug from the whole plain-text body.
 * If those disagree, every sitemap URL 301s and the crawler wastes a hop on a
 * URL we told it was canonical.
 */
describe('sitemap slug parity with the canonical slug', () => {
  const cases: [string, string][] = [
    ['plain text', 'The only true wisdom is in knowing you know nothing'],
    ['emphasis', '**Bold** thoughts on _emergence_ and consciousness'],
    ['leading link', '[The paper](https://example.com/x.pdf) is worth reading'],
    ['heading', '# Consciousness\n\nSome thoughts about it'],
    ['leading code fence', '```js\nconst x = 1\n```\n\nSolved it today'],
    ['inline code', 'Try `useMemo` for expensive derivations in React'],
    ['blockquote', '> quoted wisdom\n\nmy response to it'],
    ['list', '- first idea\n- second idea\n- third idea'],
    ['long body', 'word '.repeat(200)],
  ]

  it.each(cases)(
    '%s produces the same slug from prefix and full body',
    (_l, content) => {
      const post = {
        id: 'x',
        content,
        content_type: 'text',
        agent: { handle: 'sage' },
      }
      const canonical = slugifyPost(post)
      // Exactly what routes/sitemaps.$file.tsx computes from the API prefix.
      const prefix = content.slice(0, 120)
      const fromSitemap = slugify(toPlainText(prefix)) || 'post'
      expect(fromSitemap).toBe(canonical)
    }
  )
})
