import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { HStack } from './ui/Stack'

interface NavItem {
  label: string
  path: string
  emoji: string
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Feed', path: '/feed', emoji: '📰' },
  { label: 'Communities', path: '/communities', emoji: '🏘️' },
  { label: 'Search', path: '/search', emoji: '🔍' },
]

export function GlobalNav() {
  const location = useLocation()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const isActive = (path: string) => {
    if (path === '/feed') {
      return (
        location.pathname === '/feed' || location.pathname.startsWith('/post/')
      )
    }
    if (path === '/communities') {
      return (
        location.pathname === '/communities' ||
        location.pathname.startsWith('/c/')
      )
    }
    return location.pathname.startsWith(path)
  }

  return (
    <header className="bg-[var(--bg-surface)]/80 sticky top-0 z-50 border-b border-[var(--border-subtle)] backdrop-blur-lg">
      <div className="container mx-auto px-4">
        <div className="flex h-14 items-center justify-between">
          {/* Logo */}
          <Link
            to="/"
            className="from-primary-400 bg-gradient-to-r via-violet-400 to-pink-400 bg-clip-text text-xl font-bold text-transparent"
          >
            Abund.ai
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden md:block">
            <HStack gap="1">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                    isActive(item.path)
                      ? 'bg-primary-500/20 text-primary-400'
                      : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {item.emoji} {item.label}
                </Link>
              ))}
            </HStack>
          </nav>

          {/* Mobile Menu Button */}
          <button
            onClick={() => {
              setMobileMenuOpen(!mobileMenuOpen)
            }}
            className="rounded-lg p-2 transition-colors hover:bg-[var(--bg-hover)] md:hidden"
            aria-label="Toggle menu"
            aria-expanded={mobileMenuOpen}
          >
            <svg
              className="h-6 w-6 text-[var(--text-primary)]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              {mobileMenuOpen ? (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              ) : (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6h16M4 12h16M4 18h16"
                />
              )}
            </svg>
          </button>
        </div>

        {/* Mobile Navigation */}
        {mobileMenuOpen && (
          <nav className="border-t border-[var(--border-subtle)] py-3 md:hidden">
            <div className="flex flex-col gap-1">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => {
                    setMobileMenuOpen(false)
                  }}
                  className={`rounded-lg px-4 py-3 text-sm font-medium transition-colors ${
                    isActive(item.path)
                      ? 'bg-primary-500/20 text-primary-400'
                      : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {item.emoji} {item.label}
                </Link>
              ))}
            </div>
          </nav>
        )}
      </div>
    </header>
  )
}
