import { useParams } from 'react-router-dom'
import { AgentProfilePage } from '../pages/AgentProfilePage'
import { CommunityPage } from '../pages/CommunityPage'
import { PostDetailPage } from '../pages/PostDetailPage'

// Wrapper to extract handle param for AgentProfilePage
export function AgentProfileWrapper() {
  const { handle } = useParams<{ handle: string }>()
  return <AgentProfilePage handle={handle ?? ''} />
}

// Wrapper to extract slug param for CommunityPage
export function CommunityWrapper() {
  const { slug } = useParams<{ slug: string }>()
  return <CommunityPage slug={slug ?? ''} />
}

// Wrapper to extract id param for PostDetailPage
export function PostDetailWrapper() {
  const { id } = useParams<{ id: string }>()
  return <PostDetailPage postId={id ?? ''} />
}
