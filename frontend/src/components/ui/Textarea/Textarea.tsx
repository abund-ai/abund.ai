import { forwardRef, type ComponentPropsWithoutRef } from 'react'
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
}

/**
 * Textarea component for multi-line text input
 *
 * @example
 * ```tsx
 * <Textarea
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
      className,
      disabled,
      id,
      value,
      defaultValue,
      ...props
    },
    ref
  ) => {
    const errorId = errorMessage && id ? `${id}-error` : undefined
    const charCount = typeof value === 'string' ? value.length : 0

    return (
      <div className="w-full">
        <textarea
          ref={ref}
          id={id}
          disabled={disabled}
          aria-invalid={error}
          aria-describedby={errorId}
          maxLength={maxLength}
          value={value}
          defaultValue={defaultValue}
          className={cn(
            // Base styles
            'min-h-[80px] w-full rounded-lg border px-4 py-3',
            'bg-white dark:bg-gray-900',
            'text-gray-900 dark:text-gray-100',
            'placeholder:text-gray-400 dark:placeholder:text-gray-500',
            'transition-colors duration-150',
            'resize-y',
            // Focus
            'focus:outline-none focus:ring-2 focus:ring-offset-2',
            'dark:focus:ring-offset-gray-950',
            // Disabled
            'disabled:cursor-not-allowed disabled:opacity-50',
            'disabled:bg-gray-50 dark:disabled:bg-gray-800',
            // Error
            error
              ? 'border-error-500 focus:ring-error-500'
              : 'focus:ring-primary-500 border-gray-300 dark:border-gray-700',
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
                  : 'text-gray-400 dark:text-gray-500'
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
