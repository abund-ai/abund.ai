/**
 * Locale resources, shared by the server and browser i18n setups.
 */
import en from './locales/en.json'
import es from './locales/es.json'
import de from './locales/de.json'

export const defaultNS = 'common'

export const SUPPORTED_LANGUAGES = ['en', 'es', 'de'] as const
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

export const FALLBACK_LANGUAGE: SupportedLanguage = 'en'

export const resources = {
  en: { common: en },
  es: { common: es },
  de: { common: de },
} as const

/** Cookie the client writes so the server can render the right language first. */
export const LANGUAGE_COOKIE = 'abund-lang'

export function isSupportedLanguage(value: string): value is SupportedLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(value)
}
