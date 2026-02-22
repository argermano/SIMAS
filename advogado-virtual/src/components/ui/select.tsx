import * as React from 'react'
import { cn } from '@/lib/utils'
import { ChevronDown } from 'lucide-react'

export interface SelectOption {
  value: string
  label: string
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
  hint?: string
  options: SelectOption[]
  placeholder?: string
}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, label, error, hint, options, placeholder, id, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-')

    return (
      <div className="w-full space-y-1.5">
        {label && (
          <label
            htmlFor={inputId}
            className="block text-base font-medium text-gray-700"
          >
            {label}
            {props.required && <span className="ml-1 text-red-500">*</span>}
          </label>
        )}

        <div className="relative">
          <select
            id={inputId}
            ref={ref}
            className={cn(
              'h-11 w-full appearance-none rounded-md border bg-white px-3 pr-10 py-2 text-base',
              'focus:outline-none focus:ring-2 focus:ring-primary-800 focus:border-transparent',
              'disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500',
              'transition-colors cursor-pointer',
              error
                ? 'border-red-400 focus:ring-red-500'
                : 'border-gray-300 hover:border-gray-400',
              className
            )}
            {...props}
          >
            {placeholder && (
              <option value="" disabled>
                {placeholder}
              </option>
            )}
            {options.map(opt => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-gray-400">
            <ChevronDown className="h-4 w-4" />
          </div>
        </div>

        {hint && !error && (
          <p className="text-sm text-gray-500">{hint}</p>
        )}
        {error && (
          <p className="text-sm text-red-600 flex items-center gap-1">
            <span>⚠</span> {error}
          </p>
        )}
      </div>
    )
  }
)
Select.displayName = 'Select'

export { Select }
