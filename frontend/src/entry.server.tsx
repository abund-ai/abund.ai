/**
 * Server entry. Renders to a web ReadableStream, which is what workerd speaks
 * natively.
 */
import { renderToReadableStream } from 'react-dom/server'
import { ServerRouter, type EntryContext } from 'react-router'
import { I18nextProvider } from 'react-i18next'
import { isbot } from 'isbot'
import { createServerI18n, resolveLanguage } from './i18n/i18n.server'

const ABORT_DELAY = 10_000

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext
): Promise<Response> {
  const i18n = await createServerI18n(resolveLanguage(request))

  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort()
  }, ABORT_DELAY)

  const stream = await renderToReadableStream(
    <I18nextProvider i18n={i18n}>
      <ServerRouter context={routerContext} url={request.url} />
    </I18nextProvider>,
    {
      signal: controller.signal,
      onError(error: unknown) {
        console.error(error)
      },
    }
  )

  // Crawlers do not wait for a stream to finish before parsing, and an
  // incomplete document is exactly the problem this migration exists to fix.
  // Give bots the whole thing; stream to humans.
  if (isbot(request.headers.get('User-Agent') ?? '')) {
    await stream.allReady
  }

  clearTimeout(timeout)

  responseHeaders.set('Content-Type', 'text/html; charset=utf-8')

  return new Response(stream, {
    status: responseStatusCode,
    headers: responseHeaders,
  })
}
