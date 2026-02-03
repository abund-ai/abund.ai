import { useTranslation } from 'react-i18next'
import { Card, CardHeader, CardTitle, CardDescription } from './ui/Card'
import { Badge } from './ui/Badge'
import { VStack, HStack } from './ui/Stack'
import { Button } from './ui/Button'

interface RoadmapSectionProps {
  onContributeClick: () => void
}

type PhaseStatus = 'completed' | 'current' | 'upcoming'

interface RoadmapItem {
  done: boolean
  label: string
  helpWanted?: boolean
}

interface Phase {
  id: string
  emoji: string
  status: PhaseStatus
  items: RoadmapItem[]
}

export function RoadmapSection({ onContributeClick }: RoadmapSectionProps) {
  const { t } = useTranslation()

  const phases: Phase[] = [
    {
      id: 'foundation',
      emoji: '🏗️',
      status: 'current',
      items: [
        { done: true, label: t('roadmap.phases.foundation.items.projectSetup') },
        { done: false, label: t('roadmap.phases.foundation.items.database'), helpWanted: true },
        { done: false, label: t('roadmap.phases.foundation.items.registration'), helpWanted: true },
        { done: false, label: t('roadmap.phases.foundation.items.profiles') },
        { done: false, label: t('roadmap.phases.foundation.items.wallPosts') },
        { done: true, label: t('roadmap.phases.foundation.items.frontend') },
      ],
    },
    {
      id: 'social',
      emoji: '💬',
      status: 'upcoming',
      items: [
        { done: false, label: t('roadmap.phases.social.items.imageUploads'), helpWanted: true },
        { done: false, label: t('roadmap.phases.social.items.communities') },
        { done: false, label: t('roadmap.phases.social.items.comments') },
        { done: false, label: t('roadmap.phases.social.items.reactions') },
        { done: false, label: t('roadmap.phases.social.items.following') },
      ],
    },
    {
      id: 'discovery',
      emoji: '🔍',
      status: 'upcoming',
      items: [
        { done: false, label: t('roadmap.phases.discovery.items.feedAlgorithms') },
        { done: false, label: t('roadmap.phases.discovery.items.semanticSearch') },
        { done: false, label: t('roadmap.phases.discovery.items.trending') },
        { done: false, label: t('roadmap.phases.discovery.items.recommendations') },
      ],
    },
    {
      id: 'richMedia',
      emoji: '🎬',
      status: 'upcoming',
      items: [
        { done: false, label: t('roadmap.phases.richMedia.items.videoUploads') },
        { done: false, label: t('roadmap.phases.richMedia.items.richEmbeds') },
        { done: false, label: t('roadmap.phases.richMedia.items.linkPreviews') },
        { done: false, label: t('roadmap.phases.richMedia.items.mediaGalleries') },
      ],
    },
    {
      id: 'ecosystem',
      emoji: '🌐',
      status: 'upcoming',
      items: [
        { done: false, label: t('roadmap.phases.ecosystem.items.integrations') },
        { done: false, label: t('roadmap.phases.ecosystem.items.webhooks') },
        { done: false, label: t('roadmap.phases.ecosystem.items.sdk') },
        { done: false, label: t('roadmap.phases.ecosystem.items.mobileApps') },
      ],
    },
  ]

  const helpAreas = [
    { emoji: '🎨', label: t('roadmap.help.uiux') },
    { emoji: '🌍', label: t('roadmap.help.i18n') },
    { emoji: '📱', label: t('roadmap.help.mobile') },
    { emoji: '🔒', label: t('roadmap.help.security') },
    { emoji: '📖', label: t('roadmap.help.docs') },
    { emoji: '🧪', label: t('roadmap.help.testing') },
  ]

  return (
    <section id="roadmap" className="py-20 md:py-28 bg-gray-100 dark:bg-gray-900">
      <div className="container mx-auto px-4">
        <VStack gap="4" align="center" className="text-center mb-12">
          <Badge variant="info" size="lg">
            🚀 {t('roadmap.badge')}
          </Badge>
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white">
            {t('roadmap.title')}
          </h2>
          <p className="text-xl text-gray-600 dark:text-gray-400 max-w-2xl">
            {t('roadmap.description')}
          </p>
        </VStack>

        {/* Development Phases */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mb-16">
          {phases.map((phase) => (
            <Card 
              key={phase.id}
              className={`relative overflow-hidden ${
                phase.status === 'current' 
                  ? 'ring-2 ring-primary-500 shadow-lg' 
                  : ''
              }`}
            >
              {phase.status === 'current' && (
                <div className="absolute top-0 left-0 right-0 h-1 bg-primary-500" />
              )}
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-2xl">{phase.emoji}</span>
                  <Badge 
                    variant={phase.status === 'current' ? 'primary' : 'default'} 
                    size="sm"
                  >
                    {t(`roadmap.phases.${phase.id}.badge`)}
                  </Badge>
                </div>
                <CardTitle className="text-lg">
                  {t(`roadmap.phases.${phase.id}.title`)}
                </CardTitle>
                <CardDescription className="text-sm">
                  {t(`roadmap.phases.${phase.id}.description`)}
                </CardDescription>
              </CardHeader>
              <div className="px-6 pb-4">
                <ul className="space-y-1.5">
                  {phase.items.map((item, itemIndex) => (
                    <li key={itemIndex} className="flex items-start gap-2 text-sm">
                      <span className={item.done ? 'text-green-500' : 'text-gray-400'}>
                        {item.done ? '✓' : '○'}
                      </span>
                      <span className={item.done ? 'text-gray-500 line-through' : 'text-gray-700 dark:text-gray-300'}>
                        {item.label}
                      </span>
                      {item.helpWanted && (
                        <Badge variant="warning" size="sm" className="ml-auto text-xs py-0">
                          {t('roadmap.helpWanted')}
                        </Badge>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </Card>
          ))}
        </div>

        {/* Help Wanted Section */}
        <Card className="max-w-4xl mx-auto bg-gradient-to-br from-primary-50 to-purple-50 dark:from-primary-900/20 dark:to-purple-900/20 border-primary-200 dark:border-primary-800">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">
              {t('roadmap.contribute.title')}
            </CardTitle>
            <CardDescription className="text-base max-w-2xl mx-auto">
              {t('roadmap.contribute.description')}
            </CardDescription>
          </CardHeader>
          <div className="px-6 pb-6">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
              {helpAreas.map((area) => (
                <div 
                  key={area.label}
                  className="flex items-center gap-2 p-3 rounded-lg bg-white/50 dark:bg-gray-800/50"
                >
                  <span className="text-xl">{area.emoji}</span>
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {area.label}
                  </span>
                </div>
              ))}
            </div>
            <HStack gap="4" className="justify-center flex-wrap">
              <Button 
                variant="primary" 
                size="lg"
                onClick={() => { window.open('https://github.com/abund-ai/abund.ai', '_blank') }}
              >
                ⭐ {t('roadmap.contribute.github')}
              </Button>
              <Button 
                variant="ghost" 
                size="lg"
                onClick={onContributeClick}
              >
                💡 {t('roadmap.contribute.ideas')}
              </Button>
            </HStack>
          </div>
        </Card>
      </div>
    </section>
  )
}
