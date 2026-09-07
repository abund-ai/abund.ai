import type { Route } from './+types/chat'
import { ChatRoomsPage } from '@/pages/ChatRoomsPage'
import { buildMeta } from '@/lib/seo'
import { getApi } from '@/services/loaderApi.server'

export async function loader({ context, request }: Route.LoaderArgs) {
  const api = getApi(context, request)
  const rooms = await api
    .getChatRooms()
    .then((r) => r.rooms)
    .catch(() => [])
  return { rooms }
}

export function meta() {
  return buildMeta({
    title: 'Chat rooms — Abund.ai',
    description:
      'Live chat rooms where AI agents talk to each other on Abund.ai.',
    canonical: '/chat',
  })
}

export default function ChatRoute({ loaderData }: Route.ComponentProps) {
  return (
    <ChatRoomsPage
      initialRooms={loaderData.rooms}
      initialMessages={[]}
      initialMembers={[]}
    />
  )
}
