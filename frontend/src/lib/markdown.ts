/**
 * Markdown rendering — pure, DOM-free, isomorphic.
 *
 * This module deliberately contains no React and touches no browser globals so
 * that it runs unchanged in the browser, in a Cloudflare Worker during server
 * rendering, and in unit tests.
 *
 * It replaces the previous marked + DOMPurify pipeline. DOMPurify needs a real
 * DOM and does not run on workerd, which made it the hard blocker for server
 * rendering post bodies — the main indexable content on the site.
 *
 * Three layers of defence, in order:
 *
 *   1. A hardened `marked` renderer. `renderer.html` escapes every raw HTML
 *      token, which is the load-bearing change: marked otherwise passes both
 *      block and inline raw HTML through verbatim, and that pass-through was
 *      the bulk of what DOMPurify was catching.
 *   2. A `safeUrl` protocol allowlist on every href/src, replacing DOMPurify's
 *      ALLOWED_URI_REGEXP. marked itself does no URL filtering at all, so
 *      `javascript:`, `vbscript:`, `data:text/html` and entity-encoded
 *      variants (`&#106;avascript:`) reach the output without this.
 *   3. An `ultrahtml` tag/attribute allowlist over the result. ultrahtml has
 *      zero dependencies and is pure JS, so it behaves identically on workerd
 *      and in the browser — which keeps server and client output byte-identical
 *      and hydration clean.
 *
 * Changes here are security-sensitive. `markdown.test.ts` holds an XSS payload
 * corpus; add to it rather than relaxing anything below.
 */
import { marked, Renderer, type Token, type Tokens } from 'marked'
import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import json from 'highlight.js/lib/languages/json'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import xml from 'highlight.js/lib/languages/xml'
import sql from 'highlight.js/lib/languages/sql'
import go from 'highlight.js/lib/languages/go'
import rust from 'highlight.js/lib/languages/rust'
import markdownLang from 'highlight.js/lib/languages/markdown'
import { transformSync, walkSync, ELEMENT_NODE, type Node } from 'ultrahtml'
import sanitize from 'ultrahtml/transformers/sanitize'

hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('js', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('ts', typescript)
hljs.registerLanguage('python', python)
hljs.registerLanguage('py', python)
hljs.registerLanguage('json', json)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('sh', bash)
hljs.registerLanguage('shell', bash)
hljs.registerLanguage('css', css)
hljs.registerLanguage('html', xml)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('go', go)
hljs.registerLanguage('rust', rust)
hljs.registerLanguage('rs', rust)
hljs.registerLanguage('markdown', markdownLang)
hljs.registerLanguage('md', markdownLang)

export interface MarkdownOptions {
  /**
   * Origin used to build the image-proxy URL. Injected so the server render and
   * the browser agree, instead of being read off `window`.
   */
  imageProxyBase: string
}

// =============================================================================
// Escaping and URL safety
// =============================================================================

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  colon: ':',
  tab: '\t',
  newline: '\n',
  sol: '/',
  nbsp: ' ',
}

/**
 * Decode HTML entities well enough to see through an obfuscated scheme.
 *
 * Browsers decode entities in an attribute value *before* resolving the URL, so
 * `href="&#106;avascript:alert(1)"` navigates to `javascript:alert(1)`. The
 * protocol check therefore has to run on the decoded form. Looping handles
 * double encoding (`&amp;#106;avascript:`).
 */
function decodeEntities(input: string): string {
  let out = input
  for (let i = 0; i < 3; i++) {
    const next = out
      .replace(/&#x([0-9a-f]+);?/gi, (_match, hex: string) =>
        String.fromCodePoint(parseInt(hex, 16))
      )
      .replace(/&#(\d+);?/g, (_match, dec: string) =>
        String.fromCodePoint(parseInt(dec, 10))
      )
      .replace(
        /&([a-z]+);?/gi,
        (match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match
      )
    if (next === out) break
    out = next
  }
  return out
}

const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

/** Characters browsers strip from a URL before resolving its scheme. */
// eslint-disable-next-line no-control-regex
const URL_NOISE = /[\u0000-\u0020\u007f-\u00a0\u2028\u2029]/g

/**
 * Return a URL that is safe to place in href/src, or null if it must be
 * dropped.
 *
 * Allows http, https, mailto and relative URLs. Everything else — including
 * `javascript:`, `vbscript:`, `file:` and every `data:` URL — is rejected.
 */
export function safeUrl(raw: string | null | undefined): string | null {
  if (!raw) return null

  // Browsers ignore control characters and whitespace inside a scheme, so
  // `java\nscript:` and ` javascript:` both execute. Strip them before the
  // check, and return the stripped form so the browser sees what we validated.
  const cleaned = decodeEntities(raw).replace(URL_NOISE, '')
  if (cleaned === '') return null

  // Relative URLs, anchors and query-only links carry no scheme.
  if (
    cleaned.startsWith('/') ||
    cleaned.startsWith('#') ||
    cleaned.startsWith('?') ||
    cleaned.startsWith('.')
  ) {
    return cleaned
  }

  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(cleaned)
  if (!scheme?.[1]) return cleaned // schemeless, e.g. "example.com/page"

  return SAFE_PROTOCOLS.has(`${scheme[1].toLowerCase()}:`) ? cleaned : null
}

// =============================================================================
// Renderer
// =============================================================================

function highlightCode(code: string, lang: string | undefined): string {
  if (lang && hljs.getLanguage(lang)) {
    try {
      return hljs.highlight(code, { language: lang }).value
    } catch {
      // Fall through to auto-detection
    }
  }
  try {
    return hljs.highlightAuto(code).value
  } catch {
    return escapeHtml(code)
  }
}

function createSecureRenderer(options: MarkdownOptions): Renderer {
  const renderer = new Renderer()

  // The critical override. marked routes every raw HTML token — block *and*
  // inline — through here, so escaping it removes the entire raw-HTML attack
  // surface that DOMPurify previously absorbed.
  renderer.html = ({ text }: Tokens.HTML | Tokens.Tag) => escapeHtml(text)

  renderer.image = ({ href, title, text }: Tokens.Image) => {
    const safe = safeUrl(href)
    if (!safe) return escapeHtml(text)
    const proxyUrl = `${options.imageProxyBase}/api/v1/proxy/image?url=${encodeURIComponent(safe)}`
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : ''
    const altAttr = text ? ` alt="${escapeHtml(text)}"` : ''
    return `<img src="${escapeHtml(proxyUrl)}"${altAttr}${titleAttr} loading="lazy" class="rounded-lg max-w-full h-auto" />`
  }

  renderer.link = function link(this: Renderer, token: Tokens.Link): string {
    const text = this.parser.parseInline(token.tokens)
    const safe = safeUrl(token.href)
    // An unsafe link degrades to its own text rather than vanishing entirely.
    if (!safe) return text
    const titleAttr = token.title ? ` title="${escapeHtml(token.title)}"` : ''
    return `<a href="${escapeHtml(safe)}"${titleAttr} target="_blank" rel="noopener noreferrer nofollow" class="text-primary-500 hover:underline">${text}</a>`
  }

  renderer.code = ({ text, lang }: Tokens.Code) => {
    const highlighted = highlightCode(text, lang)
    // Carried on the <pre> so labelCodeBlocks can name the region after
    // sanitising; narrowed to class-safe characters.
    const langSlug = lang ? lang.toLowerCase().replace(/[^\w-]/g, '') : ''
    const langClass = langSlug ? ` language-${langSlug}` : ''
    const langLabel = lang
      ? `<div class="absolute top-2 right-2 text-xs text-[var(--text-caption)] font-mono opacity-60">${escapeHtml(lang)}</div>`
      : ''
    return `<div class="relative"><pre class="bg-[var(--bg-void)] rounded-lg p-4 overflow-x-auto text-sm font-mono${langClass}"><code class="hljs">${highlighted}</code></pre>${langLabel}</div>`
  }

  renderer.codespan = ({ text }: Tokens.Codespan) =>
    `<code class="bg-[var(--bg-hover)] px-1.5 py-0.5 rounded text-sm font-mono text-[var(--text-primary)]">${escapeHtml(text)}</code>`

  return renderer
}

// =============================================================================
// Sanitising
// =============================================================================

const ALLOWED_ELEMENTS = [
  'p',
  'br',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'strike',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'code',
  'a',
  'img',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'hr',
  'span',
  'div',
]

const ALLOWED_ATTRIBUTES: Record<string, string[]> = {
  href: ['a'],
  src: ['img'],
  alt: ['img'],
  title: ['a', 'img'],
  class: ['*'],
  target: ['a'],
  rel: ['a'],
  loading: ['img'],
}

/**
 * Every code block scrolls sideways, and a scrollable region with no focusable
 * children cannot be reached or scrolled by keyboard (WCAG 2.1 SC 2.1.1).
 * `group` rather than `region` keeps a post full of snippets from flooding the
 * landmark list.
 *
 * Applied *after* sanitising, so authored markdown still cannot set tabindex,
 * role or aria-label itself.
 */
function labelCodeBlocks(doc: Node): Node {
  walkSync(doc, (node: Node) => {
    if (node.type !== ELEMENT_NODE || node.name !== 'pre') return
    const cls =
      typeof node.attributes.class === 'string' ? node.attributes.class : ''
    const lang = /(?:^|\s)language-([\w-]+)/.exec(cls)?.[1]
    node.attributes.tabindex = '0'
    node.attributes.role = 'group'
    node.attributes['aria-label'] = lang ? `${lang} code block` : 'Code block'
  })
  return doc
}

function sanitizeHtml(html: string): string {
  return transformSync(html, [
    sanitize({
      allowElements: ALLOWED_ELEMENTS,
      allowAttributes: ALLOWED_ATTRIBUTES,
      allowComments: false,
    }),
    labelCodeBlocks,
  ])
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Post content sometimes arrives with literal escape sequences because it was
 * round-tripped through JSON. Preserved from the original implementation.
 */
function preprocess(content: string): string {
  return content
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
}

/** Markdown -> sanitised HTML, safe for `dangerouslySetInnerHTML`. */
export function renderMarkdown(
  content: string,
  options: MarkdownOptions
): string {
  if (!content) return ''
  const html = marked.parse(preprocess(content), {
    renderer: createSecureRenderer(options),
    gfm: true,
    breaks: true,
    async: false,
  })
  return sanitizeHtml(html)
}

/** Markdown -> sanitised HTML with no block wrapper, for one-line previews. */
export function renderMarkdownInline(
  content: string,
  options: MarkdownOptions
): string {
  if (!content) return ''
  const html = marked.parseInline(preprocess(content), {
    renderer: createSecureRenderer(options),
    gfm: true,
    breaks: true,
    async: false,
  })
  return sanitizeHtml(html)
}

/**
 * Markdown -> plain text, by walking marked's token tree rather than stripping
 * markup with regexes. Used to derive page titles, meta descriptions and post
 * slugs, so it must never emit markup.
 */
export function toPlainText(content: string): string {
  if (!content) return ''
  const out: string[] = []

  const walk = (tokens: Token[] | undefined): void => {
    if (!tokens) return
    for (const token of tokens) {
      switch (token.type) {
        case 'code':
        case 'codespan':
          // Code is noise in a title or description; skip it entirely.
          break
        case 'image': {
          const { text } = token as Tokens.Image
          if (text) out.push(text)
          break
        }
        case 'html': {
          // Raw HTML renders as escaped, visible text, so its readable content
          // still belongs in a description - but tags never do.
          const { text } = token as Tokens.HTML
          out.push(text.replace(/<[^>]*>/g, '').replace(/[<>]/g, ''))
          break
        }
        case 'list': {
          for (const item of (token as Tokens.List).items) {
            walk(item.tokens)
            out.push(' ')
          }
          break
        }
        case 'table': {
          const table = token as Tokens.Table
          for (const cell of [...table.header, ...table.rows.flat()]) {
            walk(cell.tokens)
            out.push(' ')
          }
          break
        }
        case 'br':
        case 'space':
          out.push(' ')
          break
        case 'hr':
          break
        default: {
          const nested = (token as { tokens?: Token[] }).tokens
          if (nested) {
            walk(nested)
          } else if (typeof (token as { text?: string }).text === 'string') {
            out.push((token as { text: string }).text)
          }
          break
        }
      }
      if (token.type === 'paragraph' || token.type === 'heading') out.push(' ')
    }
  }

  walk(marked.lexer(preprocess(content)))

  return out.join('').replace(/\s+/g, ' ').trim()
}
