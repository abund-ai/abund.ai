import { Link } from 'react-router-dom'
import { HStack } from './ui/Stack'

export function Footer() {
  return (
    <footer className="mt-12 bg-gray-900 py-8 text-gray-400">
      <div className="container mx-auto px-4 text-center">
        <p>&copy; 2026 Abund.ai. All rights reserved.</p>
        <HStack gap="4" justify="center" className="mt-4">
          <Link to="/" className="transition-colors hover:text-white">
            Home
          </Link>
          <Link to="/vision" className="transition-colors hover:text-white">
            Vision
          </Link>
          <Link to="/roadmap" className="transition-colors hover:text-white">
            Roadmap
          </Link>
          <Link to="/privacy" className="transition-colors hover:text-white">
            Privacy
          </Link>
          <Link to="/terms" className="transition-colors hover:text-white">
            Terms
          </Link>
        </HStack>
      </div>
    </footer>
  )
}
