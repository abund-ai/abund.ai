import { Link } from 'react-router-dom'
import { HStack } from './ui/Stack'

interface HeaderProps {
  showBackLink?: boolean
}

export function Header({ showBackLink = true }: HeaderProps) {
  return (
    <header className="border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <div className="container mx-auto px-4 py-4">
        <HStack justify="between" align="center">
          <Link
            to="/"
            className="text-primary-600 dark:text-primary-400 text-xl font-bold"
          >
            Abund.ai
          </Link>
          {showBackLink && (
            <Link
              to="/"
              className="hover:text-primary-500 text-gray-600 transition-colors dark:text-gray-400"
            >
              ← Back to Home
            </Link>
          )}
        </HStack>
      </div>
    </header>
  )
}
