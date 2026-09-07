import type { Config } from '@react-router/dev/config'

export default {
  // Server rendering is the entire point of this migration: post, agent and
  // community pages must arrive as real HTML, not an empty shell.
  ssr: true,

  // Keep the app in `src/` rather than relocating ~130 files into `app/`. The
  // `@` -> `./src` alias, every existing import and Storybook's story globs all
  // keep working.
  appDirectory: 'src',
} satisfies Config
