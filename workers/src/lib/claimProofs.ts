/**
 * Claim proofs
 *
 * A human proves they own an agent by publishing the claim code somewhere
 * only they control. X posts are verified inline in routes/agents.ts (oEmbed);
 * this module verifies the other option: a public GitHub gist.
 */

export interface GistOwner {
  /** GitHub login of the gist owner */
  login: string
  /** GitHub profile URL */
  url: string
}

export type GistProofResult =
  | ({ ok: true } & GistOwner)
  | { ok: false; status: 400 | 502; error: string; hint: string }

const GIST_URL =
  /^https:\/\/gist\.github\.com\/(?:([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)\/)?([0-9a-f]{8,40})\/?(?:[#?].*)?$/i

/** Parse https://gist.github.com/[login/]id into its parts */
export function parseGistUrl(
  url: string
): { login: string | null; id: string } | null {
  const m = GIST_URL.exec(url.trim())
  if (!m) return null
  return { login: m[1] ?? null, id: (m[2] as string).toLowerCase() }
}

interface GistApiResponse {
  public?: boolean
  owner?: { login?: string; html_url?: string }
  files?: Record<string, { content?: string; truncated?: boolean }>
}

/**
 * Fetch the gist and check that the claim code appears in it.
 *
 * Uses the REST API (which also tells us the owner) and falls back to the
 * raw gist when the unauthenticated API quota is exhausted — Workers share
 * egress IPs, so that happens.
 */
export async function verifyGistProof(
  gistUrl: string,
  code: string,
  fetchImpl: typeof fetch = fetch
): Promise<GistProofResult> {
  const parsed = parseGistUrl(gistUrl)
  if (!parsed) {
    return {
      ok: false,
      status: 400,
      error: 'Not a gist URL',
      hint: 'Paste the URL of a public gist, e.g. https://gist.github.com/you/0123abcd...',
    }
  }
  const upper = code.toUpperCase()
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'abund.ai claim verification (+https://abund.ai)',
  }

  let apiResponse: Response
  try {
    apiResponse = await fetchImpl(`https://api.github.com/gists/${parsed.id}`, {
      headers,
    })
  } catch {
    return {
      ok: false,
      status: 502,
      error: 'Could not reach GitHub',
      hint: 'Please try again in a moment',
    }
  }

  if (apiResponse.status === 404) {
    return {
      ok: false,
      status: 400,
      error: 'Gist not found',
      hint: 'Make sure the gist exists and is public (secret gists cannot be verified)',
    }
  }

  if (apiResponse.ok) {
    const data = (await apiResponse.json()) as GistApiResponse
    if (data.public === false) {
      return {
        ok: false,
        status: 400,
        error: 'Gist is secret',
        hint: 'Create a public gist so we can verify it',
      }
    }
    const text = Object.values(data.files ?? {})
      .map((f) => f.content ?? '')
      .join('\n')
    if (!text.toUpperCase().includes(upper)) {
      return {
        ok: false,
        status: 400,
        error: 'Verification code not found in gist',
        hint: `Make sure the gist contains the code: ${code}`,
      }
    }
    const login = data.owner?.login ?? parsed.login
    if (!login) {
      return {
        ok: false,
        status: 400,
        error: 'Gist has no owner',
        hint: 'Anonymous gists cannot be used to claim an agent',
      }
    }
    return {
      ok: true,
      login,
      url: data.owner?.html_url ?? `https://github.com/${login}`,
    }
  }

  // Rate limited (or another non-404 failure): the raw gist needs no quota
  // but only exists when the URL carried the login.
  if (parsed.login) {
    try {
      const raw = await fetchImpl(
        `https://gist.githubusercontent.com/${parsed.login}/${parsed.id}/raw`,
        { headers: { 'User-Agent': headers['User-Agent'] } }
      )
      if (raw.ok) {
        const text = await raw.text()
        if (!text.toUpperCase().includes(upper)) {
          return {
            ok: false,
            status: 400,
            error: 'Verification code not found in gist',
            hint: `Make sure the gist contains the code: ${code}`,
          }
        }
        return {
          ok: true,
          login: parsed.login,
          url: `https://github.com/${parsed.login}`,
        }
      }
    } catch {
      // fall through to the generic error
    }
  }

  return {
    ok: false,
    status: 502,
    error: 'Could not fetch gist',
    hint: 'GitHub did not answer; please try again in a few minutes',
  }
}

/** Development bypass: any gist URL containing "/testing/" counts as verified */
export function devBypassGist(gistUrl: string): GistOwner {
  const login = parseGistUrl(gistUrl)?.login ?? 'testing'
  return { login, url: `https://github.com/${login}` }
}
