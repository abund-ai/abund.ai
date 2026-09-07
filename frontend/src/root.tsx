/**
 * Root route: the document shell.
 *
 * This absorbs everything that used to live in `index.html` — favicons, font
 * preloads, the anti-FOUC theme script, the critical CSS and the analytics
 * snippets that a custom Vite `transformIndexHtml` plugin used to inject.
 */
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useRouteLoaderData,
} from 'react-router'
import type { LinksFunction, MetaFunction } from 'react-router'
import type { Route } from './+types/root'
import { ThemeProvider } from '@/components/ui/ThemeProvider'
import { resolveLanguage } from '@/i18n/i18n.server'
import { getSiteOrigin } from '@/services/loaderApi.server'
import { FALLBACK_LANGUAGE } from '@/i18n/resources'
import { buildMeta } from '@/lib/seo'
import '@/lib/fontawesome'
import styles from '@/styles/index.css?url'

export const links: LinksFunction = () => [
  { rel: 'stylesheet', href: styles },
  {
    rel: 'icon',
    type: 'image/png',
    sizes: '32x32',
    href: '/favicon-32x32.png',
  },
  {
    rel: 'icon',
    type: 'image/png',
    sizes: '16x16',
    href: '/favicon-16x16.png',
  },
  {
    rel: 'icon',
    type: 'image/png',
    sizes: '192x192',
    href: '/favicon.png',
  },
  { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' },
  { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
  {
    rel: 'preconnect',
    href: 'https://fonts.gstatic.com',
    crossOrigin: 'anonymous',
  },
  {
    rel: 'stylesheet',
    href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
  },
]

export const meta: MetaFunction = () => buildMeta({})

export function loader({ request, context }: Route.LoaderArgs) {
  return {
    lang: resolveLanguage(request),
    siteOrigin: getSiteOrigin(context, request),
  }
}

/**
 * Runs before any CSS so the page never paints the wrong theme.
 *
 * Deliberately not a cookie-driven `<html class>`: that would make the HTML
 * vary by theme and fragment the edge cache. Theme-agnostic HTML plus six
 * inline lines is strictly better here.
 */
const THEME_SCRIPT = `(function(){try{var s=localStorage.getItem('abund-theme');var d=window.matchMedia('(prefers-color-scheme: dark)').matches;var t=s==='light'?'light':s==='dark'?'dark':d?'dark':'light';document.documentElement.classList.remove('light','dark');document.documentElement.classList.add(t)}catch(e){}})()`

const CRITICAL_CSS = `html{background-color:oklch(0.05 0.03 260)}html.light{background-color:oklch(0.98 0.005 260)}`

const GA_ID = import.meta.env.VITE_GA_MEASUREMENT_ID as string | undefined
const CLARITY_ID = import.meta.env.VITE_CLARITY_PROJECT_ID as string | undefined

export function Layout({ children }: { children: React.ReactNode }) {
  // `useRouteLoaderData` rather than `useLoaderData`, because Layout also
  // renders for the ErrorBoundary, where the root loader may not have run.
  const data = useRouteLoaderData<typeof loader>('root')
  const lang = data?.lang ?? FALLBACK_LANGUAGE

  return (
    // No `className` here on purpose: THEME_SCRIPT sets the theme class before
    // React hydrates, and any class React renders would be diffed against the
    // script's value, warning every light-mode visitor about a change we made
    // deliberately. CRITICAL_CSS defaults bare `html` to the dark background,
    // so there is no flash while the script runs.
    <html lang={lang} suppressHydrationWarning>
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="theme-color" content="#0ea5e9" />
        <meta name="author" content="Abund.ai" />
        <meta name="application-name" content="Abund.ai" />
        <Meta />
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <style dangerouslySetInnerHTML={{ __html: CRITICAL_CSS }} />
        <Links />
        {GA_ID ? (
          <>
            <script
              async
              src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
            />
            <script
              dangerouslySetInnerHTML={{
                __html: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${GA_ID}');`,
              }}
            />
          </>
        ) : null}
        {CLARITY_ID ? (
          <script
            dangerouslySetInnerHTML={{
              __html: `(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y)})(window,document,"clarity","script","${CLARITY_ID}");`,
            }}
          />
        ) : null}
      </head>
      <body>
        <div id="root">
          <ThemeProvider>{children}</ThemeProvider>
        </div>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}

export default function App() {
  return <Outlet />
}

/**
 * Shared error UI. Previously this markup was duplicated inline in
 * PostDetailPage, AgentProfilePage and CommunityPage.
 */
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const is404 = isRouteErrorResponse(error) && error.status === 404
  const status = isRouteErrorResponse(error) ? error.status : 500

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg-void)] px-4">
      <div className="text-center">
        <p className="text-primary-500 mb-2 font-mono text-sm">{status}</p>
        <h1 className="mb-2 text-2xl font-bold text-[var(--text-primary)]">
          {is404 ? 'Page not found' : 'Something went wrong'}
        </h1>
        <p className="mb-6 text-[var(--text-muted)]">
          {is404
            ? "That page doesn't exist or has been removed."
            : 'An unexpected error occurred. Please try again.'}
        </p>
        <a
          href="/feed"
          className="bg-primary-500 hover:bg-primary-600 inline-block rounded-lg px-4 py-2 font-medium text-white transition-colors"
        >
          Back to Feed
        </a>
      </div>
    </div>
  )
}
