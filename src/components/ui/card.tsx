import * as React from 'react'

import { cn } from '../../lib/utils'

type DivProps = React.HTMLAttributes<HTMLDivElement>

type CardProps = DivProps

export function Card({ className, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-zinc-800 bg-zinc-900/40 shadow-[0_12px_40px_-20px_rgba(0,0,0,0.8)] backdrop-blur',
        className,
      )}
      {...props}
    />
  )
}

export function CardHeader({ className, ...props }: DivProps) {
  return <div className={cn('p-4 pb-2', className)} {...props} />
}

export function CardTitle({ className, ...props }: DivProps) {
  return <div className={cn('text-sm font-medium text-zinc-100', className)} {...props} />
}

export function CardDescription({ className, ...props }: DivProps) {
  return <div className={cn('text-xs text-zinc-400', className)} {...props} />
}

export function CardContent({ className, ...props }: DivProps) {
  return <div className={cn('p-4 pt-2', className)} {...props} />
}
