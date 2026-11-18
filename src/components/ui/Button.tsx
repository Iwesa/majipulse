import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'
import { Spinner } from './Spinner'

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-sky-800 text-white hover:bg-sky-900',
  secondary: 'border border-slate-400 bg-white text-slate-900 hover:bg-slate-100',
  danger: 'bg-red-700 text-white hover:bg-red-800',
  ghost: 'text-sky-900 hover:bg-sky-50',
}

export interface ButtonProps extends ComponentProps<'button'> {
  variant?: ButtonVariant
  /** Shows a spinner, disables the button, and sets aria-busy. */
  loading?: boolean
}

export function Button({
  variant = 'primary',
  loading = false,
  disabled,
  type = 'button',
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 py-2 text-base font-medium',
        'focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-sky-600',
        'disabled:cursor-not-allowed disabled:opacity-60',
        variantClasses[variant],
        className,
      )}
    >
      {loading && <Spinner decorative />}
      {children}
    </button>
  )
}
