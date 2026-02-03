import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog } from './ui/Dialog'
import { Button } from './ui/Button'
import { VStack } from './ui/Stack'

interface ContributeModalProps {
  isOpen: boolean
  onClose: () => void
}

type IdeaCategory = 'feature' | 'improvement' | 'bug' | 'other'

export function ContributeModal({ isOpen, onClose }: ContributeModalProps) {
  const { t } = useTranslation()
  const [category, setCategory] = useState<IdeaCategory>('feature')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [contact, setContact] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = (e: React.SyntheticEvent) => {
    e.preventDefault()
    setLoading(true)
    
    // Simulate API call - in production, this would create a GitHub issue or send to a backend
    setTimeout(() => {
      setLoading(false)
      setSubmitted(true)
    }, 1000)
  }

  const handleClose = () => {
    onClose()
    setTimeout(() => {
      setSubmitted(false)
      setTitle('')
      setDescription('')
      setContact('')
      setCategory('feature')
    }, 300)
  }

  const categories: { id: IdeaCategory; emoji: string }[] = [
    { id: 'feature', emoji: '✨' },
    { id: 'improvement', emoji: '🔧' },
    { id: 'bug', emoji: '🐛' },
    { id: 'other', emoji: '💭' },
  ]

  if (submitted) {
    return (
      <Dialog isOpen={isOpen} onClose={handleClose} title={t('contribute.success.title')}>
        <VStack gap="6" align="center" className="text-center py-8">
          <div className="text-6xl">🚀</div>
          <h3 className="text-2xl font-bold text-gray-900 dark:text-white">
            {t('contribute.success.headline')}
          </h3>
          <p className="text-gray-600 dark:text-gray-400 max-w-md">
            {t('contribute.success.message')}
          </p>
          <div className="bg-gray-100 dark:bg-gray-800 rounded-xl p-4 max-w-sm">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {t('contribute.success.github')}
            </p>
            <a 
              href="https://github.com/abund-ai/abund.ai/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary-500 hover:underline text-sm font-medium"
            >
              github.com/abund-ai/abund.ai/issues →
            </a>
          </div>
          <Button variant="primary" onClick={handleClose}>
            {t('contribute.success.close')}
          </Button>
        </VStack>
      </Dialog>
    )
  }

  return (
    <Dialog isOpen={isOpen} onClose={handleClose} title={t('contribute.title')}>
      <VStack gap="6">
        <p className="text-gray-600 dark:text-gray-400">
          {t('contribute.description')}
        </p>

        {/* Category Selection */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
            {t('contribute.categoryLabel')}
          </label>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {categories.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => { setCategory(cat.id) }}
                className={`p-3 rounded-lg border-2 transition-all text-center ${
                  category === cat.id
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30'
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                }`}
              >
                <div className="text-2xl mb-1">{cat.emoji}</div>
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t(`contribute.categories.${cat.id}`)}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <VStack gap="4">
            <div>
              <label htmlFor="title" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('contribute.form.title')} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="title"
                value={title}
                onChange={(e) => { setTitle(e.target.value) }}
                required
                className="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
                placeholder={t('contribute.form.titlePlaceholder')}
              />
            </div>

            <div>
              <label htmlFor="description" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('contribute.form.description')} <span className="text-red-500">*</span>
              </label>
              <textarea
                id="description"
                value={description}
                onChange={(e) => { setDescription(e.target.value) }}
                required
                rows={4}
                className="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all resize-none"
                placeholder={t('contribute.form.descriptionPlaceholder')}
              />
            </div>

            <div>
              <label htmlFor="contact" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('contribute.form.contact')} <span className="text-gray-400">({t('common.optional')})</span>
              </label>
              <input
                type="text"
                id="contact"
                value={contact}
                onChange={(e) => { setContact(e.target.value) }}
                className="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
                placeholder={t('contribute.form.contactPlaceholder')}
              />
            </div>

            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="w-full mt-2"
              disabled={loading || !title || !description}
            >
              {loading ? t('contribute.form.submitting') : t('contribute.form.submit')}
            </Button>
          </VStack>
        </form>

        {/* Alternative CTA */}
        <div className="text-center pt-4 border-t border-gray-200 dark:border-gray-700">
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
            {t('contribute.alternative')}
          </p>
          <a 
            href="https://github.com/abund-ai/abund.ai/issues/new"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-primary-500 hover:text-primary-600 font-medium text-sm"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
            {t('contribute.openIssue')}
          </a>
        </div>
      </VStack>
    </Dialog>
  )
}
