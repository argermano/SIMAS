import * as React from 'react'
import { AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
  hint?: string
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, error, hint, id, ...props }, ref) => {
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

        <textarea
          id={inputId}
          ref={ref}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : hint ? hintId : undefined}
          className={cn(
            'w-full rounded-md border bg-background px-3 py-2.5 text-base',
            'placeholder:text-muted-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-transparent',
            'disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground',
            'transition-colors resize-y min-h-[100px]',
            error
              ? 'border-destructive focus-visible:ring-destructive'
              : 'border-input hover:border-ring',
            className
          )}
          {...props}
        />

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
Textarea.displayName = 'Textarea'

export { Textarea }
