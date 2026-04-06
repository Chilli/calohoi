import * as React from 'react'

import { cn } from '../../lib/utils'

type ButtonVariant = 'default' | 'secondary' | 'outline' | 'ghost'

type ButtonSize = 'default' | 'sm' | 'lg'

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
}

const variantClasses: Record<ButtonVariant, string> = {
  default: 'bg-zinc-50 text-zinc-950 hover:bg-zinc-200',
  secondary: 'bg-zinc-900 text-zinc-50 hover:bg-zinc-800',
  outline: 'border border-zinc-800 bg-transparent text-zinc-50 hover:bg-zinc-900/40',
  ghost: 'bg-transparent text-zinc-50 hover:bg-zinc-900/40',
}

const sizeClasses: Record<ButtonSize, string> = {
  default: 'h-10 px-4 text-sm',
  sm: 'h-9 px-3 text-sm',
  lg: 'h-11 px-5 text-base',
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', type = 'button', ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-200/40 disabled:pointer-events-none disabled:opacity-50',
          variantClasses[variant],
          sizeClasses[size],
          className,
        )}
        {...props}
      />
    )
  },
)
Button.displayName = 'Button'
