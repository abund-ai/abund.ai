/**
 * Browser i18n.
 *
 * Initialised with the language the server already rendered, so the first
 * client render matches the server HTML exactly. Detection then runs only to
 * decide whether to switch, and the result is persisted to a cookie so the
 * *next* server render starts in the right language - which is what stops the
 * mismatch recurring on every visit.
 */
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import {
  resources,
  defaultNS,
  FALLBACK_LANGUAGE,
  SUPPORTED_LANGUAGES,
  LANGUAGE_COOKIE,
  isSupportedLanguage,
  type SupportedLanguage,
} from './resources'

export function initClientI18n(serverLanguage: SupportedLanguage) {
  if (i18n.isInitialized) return i18n

  void i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      resources,
      defaultNS,
      // Start where the server left off - never re-detect before hydration.
      lng: serverLanguage,
      fallbackLng: FALLBACK_LANGUAGE,
      supportedLngs: [...SUPPORTED_LANGUAGES],
      interpolation: { escapeValue: false },
      detection: {
        order: [LANGUAGE_COOKIE, 'navigator', 'localStorage', 'htmlTag'],
        caches: ['localStorage', 'cookie'],
        lookupCookie: LANGUAGE_COOKIE,
        lookupLocalStorage: 'i18nextLng',
        cookieMinutes: 60 * 24 * 365,
      },
    })

  // After hydration, honour the visitor's own preference and remember it so the
  // next server render agrees.
  const detected = new LanguageDetector(i18n.services, {
    order: ['navigator', 'localStorage'],
  }).detect()
  const candidate = Array.isArray(detected) ? detected[0] : detected
  const base = candidate?.split('-')[0]
  if (base && isSupportedLanguage(base) && base !== serverLanguage) {
    void i18n.changeLanguage(base)
  }

  const active = i18n.language.split('-')[0]
  if (active && isSupportedLanguage(active)) {
    document.cookie = `${LANGUAGE_COOKIE}=${active};path=/;max-age=${String(60 * 60 * 24 * 365)};samesite=lax`
  }

  return i18n
}

export default i18n
