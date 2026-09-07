import {
  forwardRef,
  useId,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from 'react'
import { cn } from '@/lib/utils'

const sizeStyles = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-4 text-base',
} as const

export interface InputProps extends Omit<
  ComponentPropsWithoutRef<'input'>,
  'size'
> {
  /** Size of the input */
  inputSize?: keyof typeof sizeStyles
  /** Error state */
  error?: boolean
  /** Error message to display */
  errorMessage?: string
  /** Left icon or element */
  leadingIcon?: React.ReactNode
  /** Right icon or element */
  trailingIcon?: React.ReactNode
  /**
   * Label text, rendered as a real `<label htmlFor>`. Every input needs an
   * accessible name; a `placeholder` is not one — it disappears on the first
   * keystroke and is not exposed as a name. Pass this, or an `aria-label`
   * where the surrounding design already names the field.
   */
  label?: ReactNode
  /** Keep the label for assistive tech only, when the layout already reads as labelled */
  hideLabel?: boolean
}

/**
 * Text input component with support for icons and error states
 *
 * @example
 * ```tsx
 * <Input
 *   label="Your name"
 *   placeholder="Ada Lovelace"
 *   leadingIcon={<UserIcon />}
 * />
 * ```
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      inputSize = 'md',
      error = false,
      errorMessage,
      leadingIcon,
      trailingIcon,
      label,
      hideLabel = false,
      className,
      disabled,
      id,
      ...props
    },
    ref
  ) => {
    // Falling back to a generated id means the label and the error text are
    // always wired up, whether or not the caller supplies one.
    const generatedId = useId()
    const inputId = id ?? generatedId
    const errorId = errorMessage ? `${inputId}-error` : undefined

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={inputId}
            className={cn(
              'mb-1.5 block text-sm font-medium text-[var(--text-secondary)]',
              hideLabel && 'sr-only'
            )}
          >
            {label}
          </label>
        )}
        <div className="relative">
          {leadingIcon && (
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-[var(--text-muted)]">
              {leadingIcon}
            </div>
          )}
          <input
            ref={ref}
            id={inputId}
            disabled={disabled}
            aria-invalid={error}
            aria-describedby={errorId}
            className={cn(
              // Base styles
              'w-full rounded-lg border bg-[var(--bg-surface)]',
              'text-[var(--text-primary)]',
              'placeholder:text-[var(--text-muted)]',
              'transition-colors duration-150',
              // Focus styles
              'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[var(--bg-void)]',
              // Disabled
              'disabled:cursor-not-allowed disabled:bg-[var(--bg-elevated)] disabled:opacity-50',
              // Size
              sizeStyles[inputSize],
              // Leading icon padding
              leadingIcon && 'pl-10',
              // Trailing icon padding
              trailingIcon && 'pr-10',
              // Error vs normal border
              error
                ? 'border-error-500 focus:ring-error-500'
                : 'focus:ring-primary-500 focus:border-primary-500 border-[var(--border-default)]',
              className
            )}
            {...props}
          />
          {trailingIcon && (
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-[var(--text-muted)]">
              {trailingIcon}
            </div>
          )}
        </div>
        {errorMessage && (
          <p
            id={errorId}
            className="text-error-500 mt-1.5 text-sm"
            role="alert"
          >
            {errorMessage}
          </p>
        )}
      </div>
    )
  }
)
Input.displayName = 'Input'
