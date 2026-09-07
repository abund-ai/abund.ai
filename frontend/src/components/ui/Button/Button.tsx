import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ElementType,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react'
import { cn } from '@/lib/utils'

const variantStyles = {
  primary: [
    // Ground and ink both come from theme tokens: the cyan is a light
    // substrate in dark mode and takes dark ink, but inverts to a deep
    // teal with white ink in light mode. See --btn-primary-* in index.css.
    'bg-[var(--btn-primary-bg)] text-[var(--btn-primary-fg)]',
    'hover:bg-[var(--btn-primary-bg-hover)]',
    'active:bg-[var(--btn-primary-bg-hover)]',
  ].join(' '),
  secondary: [
    'bg-[var(--bg-hover)] text-[var(--text-primary)]',
    'hover:bg-[var(--bg-elevated)]',
    'active:bg-[var(--bg-surface)]',
  ].join(' '),
  ghost: [
    'bg-transparent text-[var(--text-secondary)]',
    'hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]',
    'active:bg-[var(--bg-elevated)]',
  ].join(' '),
  danger: [
    'bg-[var(--btn-danger-bg)] text-[var(--btn-danger-fg)]',
    'hover:bg-[var(--btn-danger-bg-hover)]',
    'active:bg-[var(--btn-danger-bg-hover)]',
  ].join(' '),
} as const

const sizeStyles = {
  sm: 'h-8 px-3 text-sm gap-1.5 rounded-md',
  md: 'h-10 px-4 text-sm gap-2 rounded-lg',
  lg: 'h-12 px-6 text-base gap-2.5 rounded-lg',
} as const

interface ButtonOwnProps {
  /** Visual style variant */
  variant?: keyof typeof variantStyles
  /** Size of the button */
  size?: keyof typeof sizeStyles
  /** Full width button */
  fullWidth?: boolean
  /** Loading state */
  isLoading?: boolean
}

export type ButtonProps<C extends ElementType = 'button'> = ButtonOwnProps & {
  /**
   * Element or component to render instead of `button`. Use `as="a"` with
   * `href` for external links and `as={Link}` with `to` for in-app routes;
   * the rendered element's own props are then accepted and type-checked.
   *
   * Never wrap a Button in an anchor or a router `Link`: a `button` inside
   * an `a` is invalid HTML, so the parser reflows the tree, screen readers
   * announce two nested controls, and Enter on the button does not reliably
   * follow the link. Rendering the link *as* the button avoids all three.
   */
  as?: C
} & Omit<ComponentPropsWithoutRef<C>, keyof ButtonOwnProps | 'as'>

/**
 * Loose inner props. The exported `Button` is cast to the generic signature
 * above, which is what call sites are checked against — extra props reach
 * this renderer at runtime and are spread onto the rendered element.
 */
type ButtonRenderProps = ButtonOwnProps & {
  as?: ElementType
  className?: string
  children?: ReactNode
  disabled?: boolean
}

const ButtonBase = forwardRef<Element, ButtonRenderProps>(function Button(
  {
    as,
    variant = 'primary',
    size = 'md',
    fullWidth = false,
    isLoading = false,
    className,
    disabled,
    children,
    ...props
  },
  ref
) {
  const Component = as ?? 'button'
  // Only a native button honours `disabled`; links express it to assistive
  // tech instead, and the aria-disabled: styles below match the visuals.
  const isNativeButton = Component === 'button'
  const isInactive = disabled ?? isLoading

  return (
    <Component
      ref={ref}
      className={cn(
        // Base styles
        'inline-flex items-center justify-center font-medium',
        'transition-all duration-150',
        // Scale effects for "living" feel
        'hover:scale-[1.02] active:scale-[0.98]',
        // Links carry no underline — the variant styles do the signalling
        'no-underline',
        // Focus styles for a11y
        'focus-visible:outline-none focus-visible:ring-2',
        'focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-void)]',
        // Disabled styles, for both element kinds
        'disabled:pointer-events-none disabled:opacity-50',
        'aria-disabled:pointer-events-none aria-disabled:opacity-50',
        // Variant & size
        variantStyles[variant],
        sizeStyles[size],
        // Width
        fullWidth && 'w-full',
        className
      )}
      {...props}
      {...(isNativeButton
        ? { disabled: isInactive }
        : { 'aria-disabled': isInactive || undefined })}
      aria-busy={isLoading}
    >
      {isLoading ? (
        <>
          <svg
            className="h-4 w-4 animate-spin"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          <span className="sr-only">Loading</span>
          {children}
        </>
      ) : (
        children
      )}
    </Component>
  )
})
ButtonBase.displayName = 'Button'

/**
 * Primary UI component for user interaction
 *
 * @example
 * ```tsx
 * <Button variant="primary" onClick={handleClick}>Click me</Button>
 * <Button as="a" href="https://example.com" target="_blank" rel="noopener noreferrer">Docs</Button>
 * <Button as={Link} to="/feed">Open the feed</Button>
 * ```
 */
export const Button = ButtonBase as <C extends ElementType = 'button'>(
  props: ButtonProps<C> & { ref?: Ref<Element> }
) => ReactElement
