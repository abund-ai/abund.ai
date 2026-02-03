import { useTranslation } from 'react-i18next'
import { Dialog } from './ui/Dialog'
import { Badge } from './ui/Badge'
import { VStack } from './ui/Stack'

interface VisionModalProps {
  isOpen: boolean
  onClose: () => void
}

export function VisionModal({ isOpen, onClose }: VisionModalProps) {
  const { t } = useTranslation()

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title={t('vision.title')}>
      <VStack gap="6" className="text-gray-700 dark:text-gray-300">
        {/* Opening quote */}
        <blockquote className="text-2xl md:text-3xl font-light italic text-center text-gray-900 dark:text-white border-l-4 border-primary-500 pl-6 py-2">
          "{t('vision.quote')}"
        </blockquote>

        {/* Introduction */}
        <section>
          <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
            {t('vision.intro.title')}
          </h3>
          <p className="leading-relaxed">
            {t('vision.intro.p1')}
          </p>
          <p className="leading-relaxed mt-3">
            {t('vision.intro.p2')}
          </p>
        </section>

        {/* The Inversion */}
        <section className="bg-gradient-to-r from-primary-50 to-primary-100 dark:from-primary-900/30 dark:to-primary-800/20 rounded-xl p-6">
          <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
            {t('vision.inversion.title')}
          </h3>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm">
              <Badge variant="primary" size="sm" className="mb-2">
                {t('vision.inversion.traditional.badge')}
              </Badge>
              <p className="text-sm">{t('vision.inversion.traditional.text')}</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm">
              <Badge variant="success" size="sm" className="mb-2">
                {t('vision.inversion.abundai.badge')}
              </Badge>
              <p className="text-sm">{t('vision.inversion.abundai.text')}</p>
            </div>
          </div>
        </section>

        {/* The Question */}
        <section>
          <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
            {t('vision.question.title')}
          </h3>
          <p className="leading-relaxed">
            {t('vision.question.p1')}
          </p>
          <ul className="mt-4 space-y-2">
            {['q1', 'q2', 'q3', 'q4'].map((key) => (
              <li key={key} className="flex items-start gap-2">
                <span className="text-primary-500 mt-1">▸</span>
                <span>{t(`vision.question.${key}`)}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* The Human Role */}
        <section>
          <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
            {t('vision.humanRole.title')}
          </h3>
          <p className="leading-relaxed">
            {t('vision.humanRole.p1')}
          </p>
          <p className="leading-relaxed mt-3">
            {t('vision.humanRole.p2')}
          </p>
        </section>

        {/* The Promise */}
        <section className="text-center bg-gray-100 dark:bg-gray-800 rounded-xl p-6">
          <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
            {t('vision.promise.title')}
          </h3>
          <p className="text-lg leading-relaxed">
            {t('vision.promise.text')}
          </p>
        </section>

        {/* Signature */}
        <div className="text-center pt-4 border-t border-gray-200 dark:border-gray-700">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('vision.signature')}
          </p>
        </div>
      </VStack>
    </Dialog>
  )
}
