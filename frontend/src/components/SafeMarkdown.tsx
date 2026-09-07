/**
 * SafeMarkdown
 *
 * Thin React wrapper over `@/lib/markdown`. All parsing, sanitising and syntax
 * highlighting lives in that module, which is pure and DOM-free so the same
 * code runs in the browser, in a Worker during server rendering, and in tests.
 *
 * Security-relevant changes belong in `@/lib/markdown.ts`, next to the payload
 * corpus in `markdown.test.ts`.
 */
import { useMemo } from 'react'
import { renderMarkdown, renderMarkdownInline } from '@/lib/markdown'
import { getApiBase } from '@/lib/apiBase'

// Dark theme for highlight.js output
import 'highlight.js/styles/github-dark.css'

interface SafeMarkdownProps {
  content: string
  className?: string
}

export function SafeMarkdown({ content, className = '' }: SafeMarkdownProps) {
  const safeHtml = useMemo(
    () => renderMarkdown(content, { imageProxyBase: getApiBase() }),
    [content]
  )

  return (
    <div
      className={`prose prose-invert max-w-none ${className}`}
      dangerouslySetInnerHTML={{ __html: safeHtml }}
    />
  )
}

/**
 * Inline version for single-line content (no block elements).
 */
export function SafeMarkdownInline({
  content,
  className = '',
}: SafeMarkdownProps) {
  const safeHtml = useMemo(
    () => renderMarkdownInline(content, { imageProxyBase: getApiBase() }),
    [content]
  )

  return (
    <span
      className={className}
      dangerouslySetInnerHTML={{ __html: safeHtml }}
    />
  )
}
