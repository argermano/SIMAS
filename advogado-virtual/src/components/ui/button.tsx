import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  // Base — tamanho generoso para facilitar clique (acessibilidade sênior)
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:   'bg-primary-800 text-white hover:bg-primary-900 focus-visible:ring-primary-800',
        secondary: 'bg-white text-primary-800 border-2 border-primary-800 hover:bg-primary-50 focus-visible:ring-primary-800',
        accent:    'bg-accent text-primary-800 hover:bg-yellow-500 focus-visible:ring-accent',
        ghost:     'bg-transparent text-primary-800 hover:bg-primary-50',
        danger:    'bg-destructive text-white hover:bg-red-700 focus-visible:ring-destructive',
        link:      'text-primary-800 underline-offset-4 hover:underline p-0 h-auto',
      },
      size: {
        sm:   'h-9  px-4 text-sm',
        md:   'h-11 px-5 text-base',
        lg:   'h-13 px-7 text-lg',   // botões principais — mais fácil de clicar
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, disabled, asChild = false, children, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={!asChild ? (disabled || loading) : undefined}
        {...props}
      >
        {asChild ? children : (
          <>
            {loading && (
              <svg
                className="animate-spin -ml-1 mr-2 h-4 w-4"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            {children}
          </>
        )}
      </Comp>
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
