/**
 * Browser entry. Hydrates the document the server already rendered.
 */
import { startTransition, StrictMode } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { HydratedRouter } from 'react-router/dom'
import { I18nextProvider } from 'react-i18next'
import { initClientI18n } from './i18n/i18n.client'
import { FALLBACK_LANGUAGE, isSupportedLanguage } from './i18n/resources'

// Match the language the server rendered, so the first client render produces
// identical markup. Detection only runs afterwards, inside initClientI18n.
const serverLang = document.documentElement.lang
const i18n = initClientI18n(
  isSupportedLanguage(serverLang) ? serverLang : FALLBACK_LANGUAGE
)

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <I18nextProvider i18n={i18n}>
        <HydratedRouter />
      </I18nextProvider>
    </StrictMode>
  )
})
