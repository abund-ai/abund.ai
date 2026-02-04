import { forwardRef, type ComponentPropsWithoutRef } from 'react'
import { cn } from '@/lib/utils'

export interface CardProps extends ComponentPropsWithoutRef<'div'> {
  /** Variant style */
  variant?: 'default' | 'outline' | 'ghost'
  /** Add hover effect */
  interactive?: boolean
  /** Padding size */
  padding?: 'none' | 'sm' | 'md' | 'lg'
  /** Add ambient glow on hover */
  glow?: boolean
}

const variantStyles = {
  default:
    'bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-sm',
  outline: 'bg-transparent border border-[var(--border-subtle)]',
  ghost: 'bg-[var(--bg-hover)]',
} as const

const paddingStyles = {
  none: '',
  sm: 'p-4',
  md: 'p-6',
  lg: 'p-8',
} as const

/**
 * Card container component for grouping related content
 */
export const Card = forwardRef<HTMLDivElement, CardProps>(
  (
    {
      variant = 'default',
      interactive = false,
      padding = 'md',
      glow = false,
      className,
      children,
      ...props
    },
    ref
  ) => {
    return (
      <div
        ref={ref}
        className={cn(
          'rounded-xl',
          variantStyles[variant],
          paddingStyles[padding],
          interactive && [
            'transition-all duration-300',
            'hover:border-[var(--border-default)] hover:shadow-lg',
            'hover:scale-[1.01]',
            'cursor-pointer',
          ],
          glow && [
            'hover:shadow-[0_0_30px_oklch(0.58_0.18_240_/_0.15)]',
            'dark:hover:shadow-[0_0_30px_oklch(0.58_0.18_240_/_0.25)]',
          ],
          className
        )}
        {...props}
      >
        {children}
      </div>
    )
  }
)
Card.displayName = 'Card'

/**
 * Card header section
 */
export const CardHeader = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<'div'>
>(({ className, children, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('flex flex-col space-y-1.5', className)}
    {...props}
  >
    {children}
  </div>
))
CardHeader.displayName = 'CardHeader'

/**
 * Card title
 */
export const CardTitle = forwardRef<
  HTMLHeadingElement,
  ComponentPropsWithoutRef<'h3'>
>(({ className, children, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn(
      'text-lg font-semibold text-[var(--text-primary)]',
      className
    )}
    {...props}
  >
    {children}
  </h3>
))
CardTitle.displayName = 'CardTitle'

/**
 * Card description
 */
export const CardDescription = forwardRef<
  HTMLParagraphElement,
  ComponentPropsWithoutRef<'p'>
>(({ className, children, ...props }, ref) => (
  <p
    ref={ref}
    className={cn('text-sm text-[var(--text-muted)]', className)}
    {...props}
  >
    {children}
  </p>
))
CardDescription.displayName = 'CardDescription'

/**
 * Card content section
 */
export const CardContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<'div'>
>(({ className, children, ...props }, ref) => (
  <div ref={ref} className={cn('pt-4', className)} {...props}>
    {children}
  </div>
))
CardContent.displayName = 'CardContent'

/**
 * Card footer section
 */
export const CardFooter = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<'div'>
>(({ className, children, ...props }, ref) => (
  <div ref={ref} className={cn('flex items-center pt-4', className)} {...props}>
    {children}
  </div>
))
CardFooter.displayName = 'CardFooter'
