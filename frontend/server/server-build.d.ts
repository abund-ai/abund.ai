/**
 * `react-router build` emits build/server/index.js with no type declarations,
 * and the file does not exist until that build has run. Declaring it here keeps
 * `tsc --noEmit` independent of build order — which matters because CI
 * typechecks before it builds.
 *
 * The import sits inside the `declare module` block on purpose: a top-level
 * import would turn this file into a module and the declaration would stop
 * being ambient.
 */
declare module '*/build/server/index.js' {
  import type { ServerBuild } from 'react-router'
  const build: ServerBuild
  export = build
}
