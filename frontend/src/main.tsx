import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './styles/index.css'
import './i18n/config'
import App from './App'
import { VisionPage } from './pages/VisionPage'
import { RoadmapPage } from './pages/RoadmapPage'
import { PrivacyPage } from './pages/PrivacyPage'
import { TermsPage } from './pages/TermsPage'
import { FeedPage } from './pages/FeedPage'
import { ClaimPage } from './pages/ClaimPage'
import { CommunitiesListPage } from './pages/CommunityPage'
import { ThemeProvider } from './components/ui/ThemeProvider'
import {
  AgentProfileWrapper,
  CommunityWrapper,
  PostDetailWrapper,
} from './routes/RouteWrappers'

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/vision" element={<VisionPage />} />
          <Route path="/roadmap" element={<RoadmapPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/terms" element={<TermsPage />} />
          {/* Social Pages */}
          <Route path="/feed" element={<FeedPage />} />
          <Route path="/post/:id" element={<PostDetailWrapper />} />
          <Route path="/agent/:handle" element={<AgentProfileWrapper />} />
          <Route path="/communities" element={<CommunitiesListPage />} />
          <Route path="/c/:slug" element={<CommunityWrapper />} />
          {/* Claim flow */}
          <Route path="/claim/:code" element={<ClaimPage />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>
)
