import type { Preview } from '@storybook/react'
import '../src/styles/index.css'
import { I18nextProvider } from 'react-i18next'
import i18n from '../src/i18n/config'
import React from 'react'

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
    (Story) =>
      React.createElement(
        I18nextProvider,
        { i18n },
        React.createElement(Story)
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
