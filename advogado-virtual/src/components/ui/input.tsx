import * as React from 'react'
import { cn } from '@/lib/utils'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
  leftIcon?: React.ReactNode
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, hint, leftIcon, id, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-')

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
            className={cn(
              'h-11 w-full rounded-md border bg-background px-3 py-2 text-base',
              'placeholder:text-muted-foreground',
              'focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent',
              'disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground',
              'transition-colors',
              error
                ? 'border-destructive focus:ring-destructive'
                : 'border-input hover:border-ring',
              leftIcon && 'pl-10',
              className
            )}
            {...props}
          />
        </div>

        {hint && !error && (
          <p className="text-sm text-muted-foreground">{hint}</p>
        )}
        {error && (
          <p className="text-sm text-destructive flex items-center gap-1">
            <span>⚠</span> {error}
          </p>
        )}
      </div>
    )
  }
)
Input.displayName = 'Input'

export { Input }
