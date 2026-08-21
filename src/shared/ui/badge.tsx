import type { ReactNode } from 'react'

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'blue' | 'green' | 'yellow' | 'red'
}) {
  return <span className={`badge badge--${tone}`}>{children}</span>
}
