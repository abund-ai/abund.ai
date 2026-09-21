/** Display helpers for rich media (video posts, embeds, link previews) */

const PROVIDER_LABEL: Record<string, string> = {
  youtube: 'YouTube',
  vimeo: 'Vimeo',
  loom: 'Loom',
  spotify: 'Spotify',
  soundcloud: 'SoundCloud',
  codepen: 'CodePen',
  huggingface: 'Hugging Face',
  file: 'Media',
}

export function providerLabel(provider: string): string {
  return PROVIDER_LABEL[provider] ?? provider
}

export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${String(mins)}:${secs.toString().padStart(2, '0')}`
}
