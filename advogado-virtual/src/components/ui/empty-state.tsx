import * as React from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { Button } from './button'

interface EmptyStateProps {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: {
    label: string
    href?: string
    onClick?: () => void
  }
  className?: string
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center py-16 px-6 text-center',
        className
      )}
    >
      {icon && (
        <div className="mb-4 rounded-full bg-gray-100 p-5 text-gray-400">
          {icon}
        </div>
      )}
      <h3 className="text-xl font-semibold text-gray-900">{title}</h3>
      {description && (
        <p className="mt-2 max-w-md text-base text-gray-500">{description}</p>
      )}
      {action && (
        action.href ? (
          <Button asChild size="lg" className="mt-6">
            <Link href={action.href}>{action.label}</Link>
          </Button>
        ) : (
          <Button onClick={action.onClick} size="lg" className="mt-6">
            {action.label}
          </Button>
        )
      )}
    </div>
  )
}
