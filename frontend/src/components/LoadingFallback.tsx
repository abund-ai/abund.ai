/**
 * LoadingFallback Component
 * Used as a fallback for lazy-loaded routes
 */
export function LoadingFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg-void)]">
      <div className="flex animate-pulse flex-col items-center gap-4">
        <div className="bg-primary-500/30 h-12 w-12 rounded-full" />
        <div className="h-4 w-24 rounded bg-[var(--bg-surface)]" />
      </div>
    </div>
  )
}
