import * as React from 'react'
import { AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
  leftIcon?: React.ReactNode
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, hint, leftIcon, id, ...props }, ref) => {
    const reactId = React.useId()
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-') || reactId
    const hintId = `${inputId}-hint`
    const errorId = `${inputId}-error`

    return (
      <div className="w-full space-y-1.5">
        {label && (
          <label
            htmlFor={inputId}
            className="block text-base font-medium text-foreground"
          >
            {label}
            {props.required && <span className="ml-1 text-destructive">*</span>}
          </label>
        )}

        <div className="relative">
          {leftIcon && (
            <div className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground">
              {leftIcon}
            </div>
          )}
          <input
            id={inputId}
            ref={ref}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : hint ? hintId : undefined}
            className={cn(
              'h-11 w-full rounded-md border bg-background px-3 py-2 text-base',
              'placeholder:text-muted-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-transparent',
              'disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground',
              'transition-colors',
              error
                ? 'border-destructive focus-visible:ring-destructive'
                : 'border-input hover:border-ring',
              leftIcon && 'pl-10',
              className
            )}
            {...props}
          />
        </div>

        {hint && !error && (
          <p id={hintId} className="text-sm text-muted-foreground">{hint}</p>
        )}
        {error && (
          <p id={errorId} className="flex items-center gap-1 text-sm text-destructive">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden /> {error}
          </p>
        )}
      </div>
    )
  }
)
Input.displayName = 'Input'

export { Input }
