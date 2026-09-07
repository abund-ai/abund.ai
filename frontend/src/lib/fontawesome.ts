/**
 * FontAwesome global configuration.
 *
 * By default FontAwesome injects its own `<style>` tag into `<head>` the first
 * time an icon renders. Under SSR that happens after hydration, which makes
 * every icon flash at the wrong size on first paint. Importing the stylesheet
 * ourselves and disabling the runtime injection keeps the CSS in the normal
 * bundle, where it is present in the very first painted frame.
 *
 * This module must be imported once, before anything renders an icon.
 */
import { config } from '@fortawesome/fontawesome-svg-core'
import '@fortawesome/fontawesome-svg-core/styles.css'

config.autoAddCss = false
