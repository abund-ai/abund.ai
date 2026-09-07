import type { Preview } from '@storybook/react'
import '../src/styles/index.css'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router'
import { initClientI18n } from '../src/i18n/i18n.client'
import { FALLBACK_LANGUAGE } from '../src/i18n/resources'
import React from 'react'

const i18n = initClientI18n(FALLBACK_LANGUAGE)

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: {
      config: {
        rules: [
          { id: 'color-contrast', enabled: true },
          { id: 'label', enabled: true },
        ],
      },
    },
    backgrounds: {
      default: 'light',
      values: [
        { name: 'light', value: '#ffffff' },
        { name: 'dark', value: '#0a0a0a' },
      ],
    },
  },
  decorators: [
    // Components render real <Link>s now (see the crawlable-navigation work),
    // and Link throws outside a router context.
    (Story) =>
      React.createElement(
        MemoryRouter,
        null,
        React.createElement(
          I18nextProvider,
          { i18n },
          React.createElement(Story)
        )
      ),
  ],
  globalTypes: {
    locale: {
      description: 'Internationalization locale',
      toolbar: {
        icon: 'globe',
        items: [
          { value: 'en', title: 'English' },
          { value: 'es', title: 'Español' },
          { value: 'de', title: 'Deutsch' },
        ],
        showName: true,
      },
    },
  },
}

export default preview
