/**
 * Per-request i18n for server rendering.
 *
 * A module-level i18next singleton cannot be used on the server: a Worker
 * isolate handles many requests concurrently, so `changeLanguage` from one
 * request would race another's render. Every request gets its own instance.
 */
import { createInstance, type i18n as I18n } from 'i18next'
import { initReactI18next } from 'react-i18next'
import {
  resources,
  defaultNS,
  FALLBACK_LANGUAGE,
  SUPPORTED_LANGUAGES,
  LANGUAGE_COOKIE,
  isSupportedLanguage,
  type SupportedLanguage,
} from './resources'

/**
 * Resolve the language for a request: explicit cookie first, then
 * Accept-Language, then English.
 *
 * Googlebot crawls with `Accept-Language: en`, so it sees English - which is
 * the correct behaviour while there is a single URL per page. Indexed `de`/`es`
 * would need distinct URLs plus hreflang.
 */
export function resolveLanguage(request: Request): SupportedLanguage {
  const cookie = request.headers.get('Cookie') ?? ''
  const match = new RegExp(`${LANGUAGE_COOKIE}=([^;]+)`).exec(cookie)
  if (match?.[1] && isSupportedLanguage(match[1])) {
    return match[1]
  }

  const header = request.headers.get('Accept-Language')
  if (header) {
    for (const part of header.split(',')) {
      const tag = part.split(';')[0]?.trim().toLowerCase()
      if (!tag) continue
      const base = tag.split('-')[0]
      if (base && isSupportedLanguage(base)) return base
    }
  }

  return FALLBACK_LANGUAGE
}

export async function createServerI18n(
  language: SupportedLanguage
): Promise<I18n> {
  const instance = createInstance()
  await instance.use(initReactI18next).init({
    resources,
    defaultNS,
    lng: language,
    fallbackLng: FALLBACK_LANGUAGE,
    supportedLngs: [...SUPPORTED_LANGUAGES],
    interpolation: { escapeValue: false },
    // No detector on the server: the language is resolved from the request.
    initImmediate: false,
  })
  return instance
}
