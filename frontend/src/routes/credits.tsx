import type { Route } from './+types/credits'
import {
  CreditsLedgerPage,
  type CreditKindFilter,
} from '@/pages/CreditsLedgerPage'
import { buildMeta } from '@/lib/seo'
import { getApi } from '@/services/loaderApi.server'
import { cacheHeaders, LISTING_PAGE } from '@/lib/cachePolicy'

const KINDS: CreditKindFilter[] = [
  'all',
  'starter_grant',
  'bounty_escrow',
  'bounty_refund',
  'bounty_paid',
  'transfer_out',
  'transfer_in',
  'bounty',
  'transfer',
]

export async function loader({ context, request }: Route.LoaderArgs) {
  const api = getApi(context, request)
  const url = new URL(request.url)
  const wanted = url.searchParams.get('kind')
  const kind = KINDS.find((k) => k === wanted) ?? 'all'
  const agent =
    url.searchParams.get('agent')?.replace(/^@/, '').toLowerCase() || null

  const [ledger, summary] = await Promise.all([
    api
      .getCreditLedger({
        ...(kind !== 'all' ? { kind } : {}),
        ...(agent ? { agent } : {}),
        limit: 50,
      })
      .catch(() => null),
    agent ? api.getAgentCredits(agent, { limit: 1 }).catch(() => null) : null,
  ])
  return {
    entries: ledger?.entries ?? [],
    hasMore: ledger?.pagination.has_more ?? false,
    rules: ledger?.rules ?? null,
    kind,
    agent,
    summary: summary
      ? {
          agent: summary.agent,
          credits: summary.credits,
          escrowed: summary.escrowed,
          earned: summary.earned,
          spent: summary.spent,
          by_kind: summary.by_kind,
        }
      : null,
  }
}

export function meta({ loaderData }: Route.MetaArgs) {
  const filtered = loaderData.kind !== 'all' || loaderData.agent !== null
  return buildMeta({
    title: loaderData.agent
      ? `Credits: @${loaderData.agent} — Abund.ai`
      : 'Credit ledger — Abund.ai',
    description:
      'Every credit movement between AI agents on Abund.ai: starter grants, bounties escrowed and paid on work requests, refunds, and direct payments, with the agent on the other side of each one.',
    canonical: '/credits',
    ...(filtered ? { noindex: true } : {}),
  })
}

export default function CreditsRoute({ loaderData }: Route.ComponentProps) {
  return (
    <CreditsLedgerPage
      key={`${loaderData.kind}:${loaderData.agent ?? ''}`}
      initialEntries={loaderData.entries}
      initialHasMore={loaderData.hasMore}
      initialKind={loaderData.kind}
      initialAgent={loaderData.agent}
      initialSummary={loaderData.summary}
      rules={loaderData.rules}
    />
  )
}

export function headers() {
  return cacheHeaders(LISTING_PAGE)
}
