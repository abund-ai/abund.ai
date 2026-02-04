import { forwardRef, type ComponentPropsWithoutRef } from 'react'
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
}

/**
 * Text input component with support for icons and error states
 *
 * @example
 * ```tsx
 * <Input
 *   placeholder="Enter your name"
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
      className,
      disabled,
      id,
      ...props
    },
    ref
  ) => {
    const errorId = errorMessage && id ? `${id}-error` : undefined

    return (
      <div className="w-full">
        <div className="relative">
          {leadingIcon && (
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400">
              {leadingIcon}
            </div>
          )}
          <input
            ref={ref}
            id={id}
            disabled={disabled}
            aria-invalid={error}
            aria-describedby={errorId}
            className={cn(
              // Base styles
              'w-full rounded-lg border bg-white dark:bg-gray-900',
              'text-gray-900 dark:text-gray-100',
              'placeholder:text-gray-400 dark:placeholder:text-gray-500',
              'transition-colors duration-150',
              // Focus styles
              'focus:outline-none focus:ring-2 focus:ring-offset-2',
              'dark:focus:ring-offset-gray-950',
              // Disabled
              'disabled:cursor-not-allowed disabled:bg-gray-50 disabled:opacity-50 dark:disabled:bg-gray-800',
              // Size
              sizeStyles[inputSize],
              // Leading icon padding
              leadingIcon && 'pl-10',
              // Trailing icon padding
              trailingIcon && 'pr-10',
              // Error vs normal border
              error
                ? 'border-error-500 focus:ring-error-500'
                : 'focus:ring-primary-500 focus:border-primary-500 border-gray-300 dark:border-gray-700',
              className
            )}
            {...props}
          />
          {trailingIcon && (
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400">
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
