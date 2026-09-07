import { describe, it, expect } from 'vitest'
import { slugify, slugifyPost, postPath } from './slug'

const post = (content: string, content_type = 'text', handle = 'sage') => ({
  id: 'abc123',
  content,
  content_type,
  agent: { handle },
})

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Hello World')).toBe('hello-world')
  })

  it('strips accents rather than dropping the word', () => {
    expect(slugify('café culture')).toBe('cafe-culture')
    expect(slugify('naïve résumé')).toBe('naive-resume')
  })

  it('keeps contractions readable', () => {
    expect(slugify("don't stop")).toBe('dont-stop')
    expect(slugify('don’t stop')).toBe('dont-stop')
  })

  it('collapses punctuation and whitespace', () => {
    expect(slugify('what?!  really...  yes')).toBe('what-really-yes')
  })

  it('trims leading and trailing separators', () => {
    expect(slugify('...hello...')).toBe('hello')
    expect(slugify('   spaced   ')).toBe('spaced')
  })

  it('caps at 8 words', () => {
    expect(slugify('one two three four five six seven eight nine ten')).toBe(
      'one-two-three-four-five-six-seven-eight'
    )
  })

  it('caps length at 60 characters without cutting mid-word', () => {
    const slug = slugify(
      'extraordinarily verbose contemplation regarding consciousness emergence'
    )
    expect(slug.length).toBeLessThanOrEqual(60)
    expect(slug.endsWith('-')).toBe(false)
    // every retained segment is whole
    for (const word of slug.split('-')) {
      expect(
        'extraordinarily verbose contemplation regarding consciousness emergence'.includes(
          word
        )
      ).toBe(true)
    }
  })

  it('truncates a single over-long word rather than returning nothing', () => {
    const slug = slugify('a'.repeat(200))
    expect(slug.length).toBe(60)
  })

  it('returns empty string when nothing survives', () => {
    expect(slugify('')).toBe('')
    expect(slugify('   ')).toBe('')
    expect(slugify('!!!')).toBe('')
    expect(slugify('🚀🎉')).toBe('')
    expect(slugify('你好世界')).toBe('')
    expect(slugify('Привет')).toBe('')
  })

  it('never emits characters that need URL escaping', () => {
    const slug = slugify('Hello, World! "quoted" & <tagged> 100% #hash /slash')
    expect(slug).toMatch(/^[a-z0-9-]*$/)
    expect(encodeURIComponent(slug)).toBe(slug)
  })
})

describe('slugifyPost', () => {
  it('derives from the post body', () => {
    expect(slugifyPost(post('The only true wisdom is knowing nothing'))).toBe(
      'the-only-true-wisdom-is-knowing-nothing'
    )
  })

  it('ignores code blocks, which are noise in a URL', () => {
    expect(
      slugifyPost(post('Solved it today\n\n```js\nconst x = 1\n```'))
    ).toBe('solved-it-today')
  })

  it('uses link text, not the URL', () => {
    expect(
      slugifyPost(post('read [the paper](https://example.com/x.pdf)'))
    ).toBe('read-the-paper')
  })

  it('strips markdown emphasis', () => {
    expect(slugifyPost(post('**bold** thoughts on _things_'))).toBe(
      'bold-thoughts-on-things'
    )
  })

  // The fallback path is common, not exotic: image, audio and gallery posts
  // frequently have little or no text.
  it('falls back to type and handle when the body yields nothing', () => {
    expect(slugifyPost(post('', 'image', 'atlas'))).toBe('image-by-atlas')
    expect(slugifyPost(post('🎨', 'gallery', 'nova'))).toBe('gallery-by-nova')
    expect(slugifyPost(post('你好', 'text', 'echo'))).toBe('text-by-echo')
  })

  it('falls back to "post" when even the handle yields nothing', () => {
    expect(slugifyPost(post('', '', ''))).toBe('post')
    expect(slugifyPost(post('', '🎵', '🤖'))).toBe('post')
  })

  it('is deterministic', () => {
    const p = post('Consciousness and the nature of emergence')
    expect(slugifyPost(p)).toBe(slugifyPost(p))
  })
})

describe('postPath', () => {
  it('builds /post/<id>/<slug>', () => {
    expect(postPath(post('Hello world'))).toBe('/post/abc123/hello-world')
  })

  it('always produces a slug segment, even for empty content', () => {
    expect(postPath(post('', 'image', 'atlas'))).toBe(
      '/post/abc123/image-by-atlas'
    )
  })
})
