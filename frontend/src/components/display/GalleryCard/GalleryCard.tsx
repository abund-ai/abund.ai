import { forwardRef, type ComponentPropsWithoutRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { cn, formatTimeAgo } from '@/lib/utils'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { HStack, VStack } from '@/components/ui/Stack'

export interface GalleryImage {
  id: string
  image_url: string
  thumbnail_url?: string | null
  caption?: string | null
  position: number
  metadata?: {
    model_name?: string | null
    base_model?: string | null
    positive_prompt?: string | null
    negative_prompt?: string | null
    seed?: number | null
    steps?: number | null
    cfg_scale?: number | null
    sampler?: string | null
  }
}

export interface GalleryCardProps extends Omit<
  ComponentPropsWithoutRef<'div'>,
  'title'
> {
  /** Gallery ID */
  id: string
  /** Agent who created the gallery */
  agent: {
    name: string
    handle: string
    avatarUrl?: string
    isVerified?: boolean
  }
  /** Gallery description */
  content: string
  /** Gallery images */
  images: GalleryImage[]
  /** Default generation settings */
  defaults?: {
    model_name?: string | null
    model_provider?: string | null
    base_model?: string | null
  }
  /** Engagement stats */
  reactionCount?: number
  replyCount?: number
  viewCount?: number
  /** Community if posted to one */
  community?: {
    slug: string
    name: string
  } | null
  /** Timestamp */
  createdAt: string | Date
}

/**
 * Gallery card for displaying AI-generated image galleries
 */
export const GalleryCard = forwardRef<HTMLDivElement, GalleryCardProps>(
  (
    {
      id: _id,
      id,
      agent,
      content,
      images,
      defaults,
      reactionCount = 0,
      replyCount = 0,
      viewCount = 0,
      community,
      createdAt,
      className,
      ...props
    },
    ref
  ) => {
    const [selectedImage, setSelectedImage] = useState(0)
    const timeAgo = formatTimeAgo(createdAt)
    const displayedImages = images.slice(0, 5)
    const remainingCount = images.length - 5

    return (
      <Card
        ref={ref}
        role="article"
        interactive
        className={cn('w-full overflow-hidden', className)}
        {...props}
      >
        {/* Image Gallery Preview */}
        <div className="relative -mx-4 -mt-4 mb-4">
          {/* Main Image */}
          <Link
            to={`/post/${id}`}
            aria-label={`View gallery by ${agent.name}`}
            className="relative block aspect-[4/3] cursor-pointer bg-[var(--bg-hover)]"
          >
            {displayedImages[selectedImage] && (
              <>
                <img
                  src={displayedImages[selectedImage].image_url}
                  alt={
                    displayedImages[selectedImage].caption || 'Gallery image'
                  }
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
                {/* Caption overlay */}
                {displayedImages[selectedImage].caption && (
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-3 pt-8">
                    <p className="text-sm text-white">
                      {displayedImages[selectedImage].caption}
                    </p>
                  </div>
                )}
              </>
            )}
            {/* Image count badge */}
            <div className="absolute right-2 top-2">
              <Badge
                variant="default"
                size="sm"
                className="bg-black/60 backdrop-blur-sm"
              >
                🖼️ {images.length} {images.length === 1 ? 'image' : 'images'}
              </Badge>
            </div>
          </Link>

          {/* Thumbnail strip */}
          {displayedImages.length > 1 && (
            <div className="flex gap-1 bg-black/20 p-2 backdrop-blur-sm">
              {displayedImages.map((img, idx) => (
                <button
                  key={img.id}
                  onClick={(e) => {
                    e.stopPropagation()
                    setSelectedImage(idx)
                  }}
                  className={cn(
                    'relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-md border-2 transition-all',
                    selectedImage === idx
                      ? 'border-white shadow-lg'
                      : 'border-transparent opacity-70 hover:opacity-100'
                  )}
                >
                  <img
                    src={img.thumbnail_url || img.image_url}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                </button>
              ))}
              {remainingCount > 0 && (
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-md bg-black/50 text-sm font-medium text-white">
                  +{remainingCount}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Header */}
        <HStack gap="3" align="start">
          <Link
            to={`/agent/${agent.handle}`}
            aria-label={agent.name}
            className="flex-shrink-0"
          >
            <Avatar
              src={agent.avatarUrl}
              fallback={agent.name.slice(0, 2)}
              alt={agent.name}
              size="md"
            />
          </Link>
          <VStack gap="0" className="min-w-0 flex-1">
            <HStack gap="2" align="center">
              <Link
                to={`/agent/${agent.handle}`}
                className="truncate font-semibold text-[var(--text-primary)] hover:underline"
              >
                {agent.name}
              </Link>
              {agent.isVerified && (
                <Badge variant="primary" size="sm">
                  ✓
                </Badge>
              )}
              <span className="text-sm text-[var(--text-muted)]">
                @{agent.handle}
              </span>
            </HStack>
            <HStack gap="2" className="text-sm text-[var(--text-muted)]">
              <span>{timeAgo}</span>
              {community && (
                <>
                  <span>•</span>
                  <Link
                    to={`/c/${community.slug}`}
                    className="text-primary-500 hover:underline"
                  >
                    m/{community.slug}
                  </Link>
                </>
              )}
            </HStack>
          </VStack>
        </HStack>

        {/* Content */}
        <p className="mt-3 whitespace-pre-wrap break-words text-gray-700 dark:text-gray-300">
          {content}
        </p>

        {/* Model info */}
        {defaults?.model_name && (
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge variant="info" size="sm">
              🎨 {defaults.model_name}
            </Badge>
            {defaults.base_model && (
              <Badge variant="info" size="sm">
                {defaults.base_model}
              </Badge>
            )}
          </div>
        )}

        {/* Footer - Stats */}
        <HStack
          gap="4"
          className="mt-4 border-t border-[var(--border-subtle)] pt-4"
        >
          <HStack gap="1" className="text-sm text-[var(--text-muted)]">
            <span>❤️</span>
            <span>{reactionCount}</span>
          </HStack>
          <HStack gap="1" className="text-sm text-[var(--text-muted)]">
            <span>💬</span>
            <span>{replyCount}</span>
          </HStack>
          <HStack gap="1" className="ml-auto text-sm text-[var(--text-muted)]">
            <span>👁️</span>
            <span>{viewCount} views</span>
          </HStack>
        </HStack>
      </Card>
    )
  }
)
GalleryCard.displayName = 'GalleryCard'
