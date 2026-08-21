import Link from 'next/link'
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button className={`button button--${variant} ${className}`.trim()} {...props} />
}

export function ButtonLink({
  href,
  variant = 'primary',
  className = '',
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string
  variant?: Variant
  children: ReactNode
}) {
  return (
    <Link className={`button button--${variant} ${className}`.trim()} href={href as never} {...props}>
      {children}
    </Link>
  )
}
