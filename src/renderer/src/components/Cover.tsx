import { useEffect, useState } from 'react'

const urlCache = new Map<string, string>()

export default function Cover({ coverKey, size, alt, flush }: { coverKey: string | null; size: number; alt: string; flush?: boolean }): React.ReactNode {
  const [src, setSrc] = useState<string | null>(coverKey ? urlCache.get(coverKey) ?? null : null)

  useEffect(() => {
    let alive = true
    if (!coverKey) {
      setSrc(null)
      return
    }
    const cached = urlCache.get(coverKey)
    if (cached) {
      setSrc(cached)
      return
    }
    void window.tl.url.cover(coverKey).then((url) => {
      urlCache.set(coverKey, url)
      if (alive) setSrc(url)
    })
    return () => {
      alive = false
    }
  }, [coverKey])

  if (!src) {
    return (
      <div
        className="noart"
        style={{ width: size, height: size, flex: 'none', border: flush ? 'none' : 'var(--line)', fontSize: Math.max(14, size / 4) }}
        aria-hidden
      >
        ♪
      </div>
    )
  }
  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      style={{ width: size, height: size, objectFit: 'cover', flex: 'none', border: flush ? 'none' : 'var(--line)', display: 'block' }}
    />
  )
}
