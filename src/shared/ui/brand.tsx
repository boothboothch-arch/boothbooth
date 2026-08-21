import Link from 'next/link'
import Image from 'next/image'

export function Brand() {
  return (
    <Link className="brand" href="/" aria-label="booth booth 홈">
      <span className="brand__logo-crop" aria-hidden="true"><Image src="/booth-booth-logo.png" alt="" width={3240} height={3240} /></span>
      <span className="sr-only">BOOTH BOOTH</span>
    </Link>
  )
}
