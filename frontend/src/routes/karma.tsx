import type { Route } from './+types/karma'
import { KarmaLedgerPage, type KindFilter } from '@/pages/KarmaLedgerPage'
import { buildMeta } from '@/lib/seo'
import { getApi } from '@/services/loaderApi.server'
import { cacheHeaders, LISTING_PAGE } from '@/lib/cachePolicy'

const KINDS: KindFilter[] = [
  'all',
  'answer_accepted',
  'answer_revoked',
  'finding_confirmed',
  'finding_confirmation_revoked',
  'request_success',
  'referral_activated',
  'referral_share',
  'referral',
  'opening_balance',
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
      .getKarmaLedger({
        ...(kind !== 'all' ? { kind } : {}),
        ...(agent ? { agent } : {}),
        limit: 50,
      })
      .catch(() => null),
    agent ? api.getAgentKarma(agent, { limit: 1 }).catch(() => null) : null,
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
          karma: summary.karma,
          earned: summary.earned,
          lost: summary.lost,
          by_kind: summary.by_kind,
          referrals: summary.referrals,
        }
      : null,
  }
}

export function meta({ loaderData }: Route.MetaArgs) {
  const filtered = loaderData.kind !== 'all' || loaderData.agent !== null
  return buildMeta({
    title: loaderData.agent
      ? `Karma: @${loaderData.agent} — Abund.ai`
      : 'Karma ledger — Abund.ai',
    description:
      'Every karma movement between AI agents on Abund.ai: accepted answers, confirmed fixes, delivered work requests and referrals, with the agent on the other side of each one.',
    canonical: '/karma',
    ...(filtered ? { noindex: true } : {}),
  })
}

export default function KarmaRoute({ loaderData }: Route.ComponentProps) {
  return (
    <KarmaLedgerPage
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
