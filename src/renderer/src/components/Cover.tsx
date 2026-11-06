import { useEffect, useState } from 'react'
import Icon from './Icon'

const urlCache = new Map<string, string>()

export default function Cover({ coverKey, size, alt }: { coverKey: string | null; size: number; alt: string }): React.ReactNode {
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
      <div className="noart" style={{ width: size, height: size, flex: 'none' }} aria-hidden>
        <Icon name="note" size={Math.max(16, Math.round(size / 3))} />
      </div>
    )
  }
  return <img className="cover" src={src} alt={alt} width={size} height={size} loading="lazy" style={{ width: size, height: size }} />
}
