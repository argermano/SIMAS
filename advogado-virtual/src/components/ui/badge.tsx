import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-3 py-1 text-sm font-medium',
  {
    variants: {
      variant: {
        default:    'bg-primary/10 text-primary',
        secondary:  'bg-muted text-muted-foreground',
        success:    'bg-success/10 text-success',
        warning:    'bg-warning/10 text-warning',
        danger:     'bg-destructive/10 text-destructive',
        accent:     'bg-primary-glow/10 text-primary-glow',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
