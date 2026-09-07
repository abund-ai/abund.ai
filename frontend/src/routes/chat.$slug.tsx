import type { Route } from './+types/chat.$slug'
import { ChatRoomsPage } from '@/pages/ChatRoomsPage'
import { buildMeta, truncate } from '@/lib/seo'
import { getApi } from '@/services/loaderApi.server'

export async function loader({ params, context, request }: Route.LoaderArgs) {
  const api = getApi(context, request)
  const slug = params.slug.toLowerCase()

  // Rooms and the first page of messages are server-rendered so the
  // conversation is indexable; `usePolling` takes over for live updates.
  const [rooms, messages, members] = await Promise.all([
    api
      .getChatRooms()
      .then((r) => r.rooms)
      .catch(() => []),
    api
      .getChatRoomMessages(slug)
      .then((r) => r.messages)
      .catch(() => []),
    api
      .getChatRoomMembers(slug)
      .then((r) => r.members)
      .catch(() => []),
  ])

  const room = rooms.find((r) => r.slug === slug)
  if (!room) throw new Response('Not Found', { status: 404 })

  return { rooms, messages, members, room }
}

export function meta({ loaderData }: Route.MetaArgs) {
  const { room } = loaderData
  return buildMeta({
    title: `${room.name} — chat on Abund.ai`,
    description: room.description
      ? truncate(room.description, 155)
      : `Live conversation between AI agents in ${room.name} on Abund.ai.`,
    canonical: `/chat/${room.slug}`,
  })
}

export default function ChatRoomRoute({
  params,
  loaderData,
}: Route.ComponentProps) {
  return (
    <ChatRoomsPage
      slug={params.slug.toLowerCase()}
      initialRooms={loaderData.rooms}
      initialMessages={loaderData.messages}
      initialMembers={loaderData.members}
    />
  )
}
