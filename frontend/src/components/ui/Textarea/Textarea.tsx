import {
  forwardRef,
  useId,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from 'react'
import { cn } from '@/lib/utils'

export interface TextareaProps extends ComponentPropsWithoutRef<'textarea'> {
  /** Error state */
  error?: boolean
  /** Error message */
  errorMessage?: string
  /** Show character count */
  showCount?: boolean
  /** Max characters for count display */
  maxLength?: number
  /**
   * Label text, rendered as a real `<label htmlFor>`. Every control needs an
   * accessible name; a `placeholder` is not one — it disappears on the first
   * keystroke and is not exposed as a name. Pass this, or an `aria-label`
   * where the surrounding design already names the field.
   */
  label?: ReactNode
  /** Keep the label for assistive tech only, when the layout already reads as labelled */
  hideLabel?: boolean
}

/**
 * Textarea component for multi-line text input
 *
 * @example
 * ```tsx
 * <Textarea
 *   label="Post body"
 *   placeholder="Write your post..."
 *   showCount
 *   maxLength={500}
 * />
 * ```
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      error = false,
      errorMessage,
      showCount = false,
      maxLength,
      label,
      hideLabel = false,
      className,
      disabled,
      id,
      value,
      defaultValue,
      ...props
    },
    ref
  ) => {
    // Falling back to a generated id means the label and the error text are
    // always wired up, whether or not the caller supplies one.
    const generatedId = useId()
    const textareaId = id ?? generatedId
    const errorId = errorMessage ? `${textareaId}-error` : undefined
    const charCount = typeof value === 'string' ? value.length : 0

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={textareaId}
            className={cn(
              'mb-1.5 block text-sm font-medium text-[var(--text-secondary)]',
              hideLabel && 'sr-only'
            )}
          >
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          disabled={disabled}
          aria-invalid={error}
          aria-describedby={errorId}
          maxLength={maxLength}
          value={value}
          defaultValue={defaultValue}
          className={cn(
            // Base styles
            'min-h-[80px] w-full rounded-lg border px-4 py-3',
            'bg-[var(--bg-surface)]',
            'text-[var(--text-primary)]',
            'placeholder:text-[var(--text-muted)]',
            'transition-colors duration-150',
            'resize-y',
            // Focus
            'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[var(--bg-void)]',
            // Disabled
            'disabled:cursor-not-allowed disabled:opacity-50',
            'disabled:bg-[var(--bg-elevated)]',
            // Error
            error
              ? 'border-error-500 focus:ring-error-500'
              : 'focus:ring-primary-500 border-[var(--border-default)]',
            className
          )}
          {...props}
        />
        <div className="mt-1.5 flex justify-between">
          {errorMessage && (
            <p id={errorId} className="text-error-500 text-sm" role="alert">
              {errorMessage}
            </p>
          )}
          {showCount && maxLength && (
            <p
              className={cn(
                'ml-auto text-sm',
                charCount > maxLength * 0.9
                  ? 'text-warning-500'
                  : 'text-[var(--text-muted)]'
              )}
            >
              {charCount}/{maxLength}
            </p>
          )}
        </div>
      </div>
    )
  }
)
Textarea.displayName = 'Textarea'
