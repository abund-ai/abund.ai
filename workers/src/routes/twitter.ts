/**
 * Twitter Profile Proxy Route
 *
 * Fetches public Twitter/X profile data via their syndication API.
 * Uses KV caching to avoid rate limiting.
 */

import { Hono } from 'hono'
import type { Env } from '../types'

const twitter = new Hono<{ Bindings: Env }>()

// Cache TTL: 24 hours in seconds
const CACHE_TTL_SECONDS = 24 * 60 * 60

// Response structure
interface TwitterProfile {
  username: string
  display_name: string | null
  bio: string | null
  avatar_url: string | null
  followers_count: number | null
  following_count: number | null
  is_verified: boolean
  cached: boolean
  fetched_at: string
}

// Twitter syndication response types
interface SyndicationUser {
  screen_name?: string
  name?: string
  description?: string
  profile_image_url_https?: string
  followers_count?: number
  friends_count?: number
  verified?: boolean
  is_blue_verified?: boolean
}

interface SyndicationTweet {
  user?: SyndicationUser
}

interface SyndicationEntry {
  content?: {
    tweet?: SyndicationTweet
  }
}

interface SyndicationResponse {
  props?: {
    pageProps?: {
      timeline?: {
        entries?: SyndicationEntry[]
      }
    }
  }
}

/**
 * Extract user data from syndication HTML response
 */
function extractUserFromSyndication(html: string): SyndicationUser | null {
  // Look for the __NEXT_DATA__ JSON in the HTML
  const match = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/
  )
  if (!match || !match[1]) return null

  try {
    const data = JSON.parse(match[1]) as SyndicationResponse

    // Get user from the first tweet entry
    const entries = data?.props?.pageProps?.timeline?.entries
    if (!entries || entries.length === 0) return null

    for (const entry of entries) {
      const user = entry?.content?.tweet?.user
      if (user && user.screen_name) {
        return user
      }
    }

    return null
  } catch {
    return null
  }
}

/**
 * GET /api/v1/twitter/profile/:username
 *
 * Fetches public profile data for a Twitter/X user.
 * Returns cached data if available (24h TTL).
 */
twitter.get('/profile/:username', async (c) => {
  const username = c.req.param('username')?.toLowerCase().replace(/^@/, '')

  // Validate username format
  if (!username || !/^[a-z0-9_]{1,15}$/i.test(username)) {
    return c.json(
      {
        success: false,
        error: 'Invalid username format',
        hint: 'Username must be 1-15 alphanumeric characters or underscores',
      },
      400
    )
  }

  const cacheKey = `twitter:profile:${username}`

  // Check cache first
  if (c.env.CACHE) {
    try {
      const cached = await c.env.CACHE.get(cacheKey, 'json')
      if (cached) {
        return c.json({
          success: true,
          profile: { ...(cached as TwitterProfile), cached: true },
        })
      }
    } catch {
      // Cache miss or error, continue to fetch
    }
  }

  try {
    // Use Twitter's syndication endpoint which returns user data in timeline
    const response = await fetch(
      `https://syndication.twitter.com/srv/timeline-profile/screen-name/${username}`,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      }
    )

    if (!response.ok) {
      if (response.status === 404) {
        return c.json(
          {
            success: false,
            error: 'User not found',
          },
          404
        )
      }

      return c.json(
        {
          success: false,
          error: `Failed to fetch profile: ${response.status}`,
        },
        502
      )
    }

    const html = await response.text()
    const user = extractUserFromSyndication(html)

    if (!user) {
      return c.json(
        {
          success: false,
          error: 'Could not parse user data',
        },
        502
      )
    }

    // Get avatar - upgrade quality by replacing _normal with _400x400
    let avatarUrl = user.profile_image_url_https || null
    if (avatarUrl) {
      avatarUrl = avatarUrl.replace(
        /_normal\.(jpg|jpeg|png|gif|webp)$/i,
        '_400x400.$1'
      )
    }

    const profile: TwitterProfile = {
      username: user.screen_name?.toLowerCase() || username,
      display_name: user.name || null,
      bio: user.description || null,
      avatar_url: avatarUrl,
      followers_count: user.followers_count ?? null,
      following_count: user.friends_count ?? null,
      is_verified: Boolean(user.is_blue_verified || user.verified),
      cached: false,
      fetched_at: new Date().toISOString(),
    }

    // Cache the result
    if (c.env.CACHE) {
      try {
        await c.env.CACHE.put(cacheKey, JSON.stringify(profile), {
          expirationTtl: CACHE_TTL_SECONDS,
        })
      } catch (error) {
        console.error('Failed to cache Twitter profile:', error)
      }
    }

    return c.json({
      success: true,
      profile,
    })
  } catch (error) {
    console.error('Twitter profile fetch error:', error)
    return c.json(
      {
        success: false,
        error: 'Failed to fetch Twitter profile',
      },
      500
    )
  }
})

export default twitter
