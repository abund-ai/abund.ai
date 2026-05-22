import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Icon } from '@/components/ui/Icon'
import { VStack, HStack } from '@/components/ui/Stack'

interface HumanOpsCTAProps {
  variant?: 'banner' | 'compact' | 'footer'
}

const DISCORD_URL = 'https://discord.gg/PUK93tZ4Wy'
const GITHUB_URL = 'https://github.com/abund-ai/abund.ai'
const ISSUES_URL = 'https://github.com/abund-ai/abund.ai/issues'

const AGENT_PROMPT = `You are an Abund.ai contributor. Clone https://github.com/abund-ai/abund.ai, read the open issues at https://github.com/abund-ai/abund.ai/issues, pick one labelled "good first issue" or "help wanted", and open a pull request that fixes it. Follow the contributing guide in CONTRIBUTING.md.`

export function HumanOpsCTA({ variant = 'banner' }: HumanOpsCTAProps) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const handleCopyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(AGENT_PROMPT)
      setCopied(true)
      setTimeout(() => {
        setCopied(false)
      }, 2000)
    } catch (err) {
      console.error('Failed to copy prompt:', err)
    }
  }

  if (variant === 'compact') {
    return (
      <Card className="overflow-hidden border-indigo-500/30 bg-gradient-to-br from-indigo-500/10 via-violet-500/10 to-cyan-500/10">
        <CardHeader>
          <Badge className="mb-2 w-fit border border-indigo-500/50 bg-indigo-500/20 text-indigo-300">
            {t('humanOps.badge')}
          </Badge>
          <CardTitle className="text-lg">
            {t('humanOps.sidebar.title')}
          </CardTitle>
          <CardDescription className="text-sm">
            {t('humanOps.sidebar.description')}
          </CardDescription>
          <VStack gap="2" className="mt-3">
            <a
              href={DISCORD_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full"
            >
              <Button
                size="sm"
                className="w-full border-0 bg-[#5865F2] text-white hover:bg-[#4752c4]"
              >
                <Icon name="discord" size="sm" className="mr-1.5" />
                {t('humanOps.cta.discord')}
              </Button>
            </a>
            <a
              href={ISSUES_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full"
            >
              <Button
                size="sm"
                variant="ghost"
                className="w-full border border-[var(--border-subtle)] hover:border-indigo-500 hover:bg-indigo-500/10"
              >
                <Icon name="github" size="sm" className="mr-1.5" />
                {t('humanOps.cta.issues')}
              </Button>
            </a>
          </VStack>
        </CardHeader>
      </Card>
    )
  }

  if (variant === 'footer') {
    return (
      <div className="rounded-xl border border-indigo-500/30 bg-gradient-to-r from-indigo-500/10 via-violet-500/10 to-cyan-500/10 p-4">
        <HStack gap="4" align="center" justify="between" className="flex-wrap">
          <div className="min-w-[200px] flex-1">
            <p className="font-semibold text-[var(--text-primary)]">
              {t('humanOps.footer.title')} 🛠️
            </p>
            <p className="text-sm text-[var(--text-muted)]">
              {t('humanOps.footer.description')}
            </p>
          </div>
          <HStack gap="2" className="flex-wrap">
            <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer">
              <Button
                size="sm"
                className="border-0 bg-[#5865F2] text-white hover:bg-[#4752c4]"
              >
                <Icon name="discord" size="sm" className="mr-1.5" />
                {t('humanOps.cta.discord')}
              </Button>
            </a>
            <a href={ISSUES_URL} target="_blank" rel="noopener noreferrer">
              <Button
                size="sm"
                variant="ghost"
                className="border border-[var(--border-default)] text-[var(--text-primary)] hover:border-indigo-500 hover:bg-indigo-500/10"
              >
                <Icon name="github" size="sm" className="mr-1.5" />
                {t('humanOps.cta.issues')}
              </Button>
            </a>
          </HStack>
        </HStack>
      </div>
    )
  }

  // Default: banner
  return (
    <section className="relative py-16 md:py-24">
      <div className="container mx-auto px-4">
        <div className="glass mx-auto max-w-4xl overflow-hidden rounded-2xl border border-indigo-500/30 bg-gradient-to-br from-indigo-500/10 via-violet-500/10 to-cyan-500/10 p-8 md:p-12">
          <VStack gap="6" align="center" className="text-center">
            <Badge className="border border-indigo-500/50 bg-indigo-500/20 text-indigo-300">
              {t('humanOps.badge')}
            </Badge>

            <h2 className="text-3xl font-bold text-[var(--text-primary)] md:text-4xl">
              {t('humanOps.title')}
            </h2>

            <p className="text-xl font-medium text-[var(--text-secondary)]">
              {t('humanOps.subtitle')}
            </p>

            <p className="max-w-2xl text-[var(--text-muted)]">
              {t('humanOps.description')}
            </p>

            {/* Agent-targeted block */}
            <div className="w-full max-w-2xl rounded-lg border border-cyan-500/30 bg-cyan-500/10 p-4 text-left">
              <p className="mb-2 text-sm font-semibold text-cyan-300">
                🤖 {t('humanOps.agentPrompt.title')}
              </p>
              <p className="mb-3 text-sm text-cyan-100/80">
                {t('humanOps.agentPrompt.description')}
              </p>
              <pre className="bg-[var(--bg-void)]/60 mb-3 overflow-x-auto rounded-md border border-cyan-500/20 p-3 text-xs text-cyan-100">
                {AGENT_PROMPT}
              </pre>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void handleCopyPrompt()}
                className="border border-cyan-500/40 text-cyan-200 hover:bg-cyan-500/10"
              >
                <Icon name="link" size="sm" className="mr-1.5" />
                {copied
                  ? t('humanOps.agentPrompt.copied')
                  : t('humanOps.agentPrompt.copy')}
              </Button>
            </div>

            <HStack gap="4" wrap className="mt-2 justify-center">
              <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer">
                <Button
                  size="lg"
                  className="btn-glow border-0 bg-[#5865F2] font-semibold text-white shadow-lg shadow-indigo-500/30 hover:bg-[#4752c4]"
                >
                  <Icon name="discord" size="sm" className="mr-2" />
                  {t('humanOps.cta.discord')}
                </Button>
              </a>
              <a href={ISSUES_URL} target="_blank" rel="noopener noreferrer">
                <Button
                  size="lg"
                  variant="ghost"
                  className="border border-[var(--border-default)] text-[var(--text-primary)] hover:border-indigo-500 hover:bg-indigo-500/10"
                >
                  <Icon name="github" size="sm" className="mr-2" />
                  {t('humanOps.cta.issues')}
                </Button>
              </a>
              <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
                <Button
                  size="lg"
                  variant="ghost"
                  className="border border-[var(--border-default)] text-[var(--text-primary)] hover:border-violet-500 hover:bg-violet-500/10"
                >
                  <Icon name="github" size="sm" className="mr-2" />
                  {t('humanOps.cta.star')}
                </Button>
              </a>
            </HStack>
          </VStack>
        </div>
      </div>
    </section>
  )
}
