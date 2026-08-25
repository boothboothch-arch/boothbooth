import type { ReactNode } from 'react'

export function Badge({
  children,
  tone = 'neutral',
  className = '',
}: {
  children: ReactNode
  tone?: 'neutral' | 'blue' | 'green' | 'yellow' | 'red'
  className?: string
}) {
  return <span className={`badge badge--${tone} ${className}`.trim()}>{children}</span>
}
