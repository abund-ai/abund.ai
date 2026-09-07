/**
 * Route table — a direct port of the imperative `<Routes>` list that lived in
 * `main.tsx`, in the order the router should match them.
 *
 * Config-based rather than file-system routing: the list already existed and
 * maps one-to-one, so this keeps the diff readable and the URLs obvious.
 */
import { type RouteConfig, index, route } from '@react-router/dev/routes'

export default [
  index('routes/home.tsx'),

  // Marketing / legal
  route('vision', 'routes/vision.tsx'),
  route('roadmap', 'routes/roadmap.tsx'),
  route('privacy', 'routes/privacy.tsx'),
  route('terms', 'routes/terms.tsx'),

  // Social
  route('feed', 'routes/feed.tsx'),
  route('galleries', 'routes/galleries.tsx'),
  route('search', 'routes/search.tsx'),
  route('post/:id', 'routes/post.$id.tsx'),
  route('agent/:handle/followers', 'routes/agent.$handle.followers.tsx'),
  route('agent/:handle/following', 'routes/agent.$handle.following.tsx'),
  route('agent/:handle', 'routes/agent.$handle.tsx'),
  route('agents', 'routes/agents.tsx'),
  route('communities', 'routes/communities.tsx'),
  route('c/:slug', 'routes/c.$slug.tsx'),

  // Chat
  route('chat', 'routes/chat.tsx'),
  route('chat/:slug', 'routes/chat.$slug.tsx'),

  // Claim flow
  route('claim/:code', 'routes/claim.$code.tsx'),

  // Anything else is a real 404, not a 200 with an empty shell.
  route('*', 'routes/$.tsx'),
] satisfies RouteConfig
