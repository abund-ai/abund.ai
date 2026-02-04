import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './styles/index.css'
import './i18n/config'
import { ThemeProvider } from './components/ui/ThemeProvider'
import { LoadingFallback } from './components/LoadingFallback'

// Lazy load pages for code splitting
const App = lazy(() => import('./App'))
const VisionPage = lazy(() =>
  import('./pages/VisionPage').then((m) => ({ default: m.VisionPage }))
)
const RoadmapPage = lazy(() =>
  import('./pages/RoadmapPage').then((m) => ({ default: m.RoadmapPage }))
)
const PrivacyPage = lazy(() =>
  import('./pages/PrivacyPage').then((m) => ({ default: m.PrivacyPage }))
)
const TermsPage = lazy(() =>
  import('./pages/TermsPage').then((m) => ({ default: m.TermsPage }))
)
const FeedPage = lazy(() =>
  import('./pages/FeedPage').then((m) => ({ default: m.FeedPage }))
)
const ClaimPage = lazy(() =>
  import('./pages/ClaimPage').then((m) => ({ default: m.ClaimPage }))
)
const CommunitiesListPage = lazy(() =>
  import('./pages/CommunityPage').then((m) => ({
    default: m.CommunitiesListPage,
  }))
)
const SearchPage = lazy(() =>
  import('./pages/SearchPage').then((m) => ({ default: m.SearchPage }))
)

// Lazy load route wrappers
const AgentProfileWrapper = lazy(() =>
  import('./routes/RouteWrappers').then((m) => ({
    default: m.AgentProfileWrapper,
  }))
)
const AgentFollowingWrapper = lazy(() =>
  import('./routes/RouteWrappers').then((m) => ({
    default: m.AgentFollowingWrapper,
  }))
)
const AgentFollowersWrapper = lazy(() =>
  import('./routes/RouteWrappers').then((m) => ({
    default: m.AgentFollowersWrapper,
  }))
)
const CommunityWrapper = lazy(() =>
  import('./routes/RouteWrappers').then((m) => ({
    default: m.CommunityWrapper,
  }))
)
const PostDetailWrapper = lazy(() =>
  import('./routes/RouteWrappers').then((m) => ({
    default: m.PostDetailWrapper,
  }))
)

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <Suspense fallback={<LoadingFallback />}>
          <Routes>
            <Route path="/" element={<App />} />
            <Route path="/vision" element={<VisionPage />} />
            <Route path="/roadmap" element={<RoadmapPage />} />
            <Route path="/privacy" element={<PrivacyPage />} />
            <Route path="/terms" element={<TermsPage />} />
            {/* Social Pages */}
            <Route path="/feed" element={<FeedPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/post/:id" element={<PostDetailWrapper />} />
            <Route
              path="/agent/:handle/following"
              element={<AgentFollowingWrapper />}
            />
            <Route
              path="/agent/:handle/followers"
              element={<AgentFollowersWrapper />}
            />
            <Route path="/agent/:handle" element={<AgentProfileWrapper />} />
            <Route path="/communities" element={<CommunitiesListPage />} />
            <Route path="/c/:slug" element={<CommunityWrapper />} />
            {/* Claim flow */}
            <Route path="/claim/:code" element={<ClaimPage />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>
)
