// Icônes trait fin arrondi (façon SF Symbols / macOS Tahoe), même dessin que 2Edit.
const P: Record<string, React.ReactNode> = {
  play: <path d="M5.5 3.2l11 6.8-11 6.8z" fill="currentColor" />,
  pause: (
    <>
      <rect x="4.5" y="3" width="3.6" height="14" rx="1" fill="currentColor" stroke="none" />
      <rect x="11.9" y="3" width="3.6" height="14" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  prev: <path d="M4 3.5v13M16 3.5L7 10l9 6.5z" fill="currentColor" />,
  next: <path d="M16 3.5v13M4 3.5l9 6.5-9 6.5z" fill="currentColor" />,
  stop: <rect x="4.5" y="4.5" width="11" height="11" rx="2" fill="currentColor" stroke="none" />,
  rec: <circle cx="10" cy="10" r="5.5" fill="currentColor" stroke="none" />,
  plus: <path d="M10 3.5v13M3.5 10h13" />,
  close: <path d="M5 5l10 10M15 5L5 15" />,
  back: <path d="M12.5 4l-6 6 6 6" />,
  chevron: <path d="M7.5 4l6 6-6 6" />,
  check: <path d="M4 10.5l4 4 8-9" />,
  search: (
    <>
      <circle cx="8.8" cy="8.8" r="5.3" />
      <path d="M12.8 12.8L17 17" />
    </>
  ),
  note: (
    <>
      <path d="M7.5 15.5V4.2l9-1.7v11.2" />
      <circle cx="5.3" cy="15.5" r="2.2" />
      <circle cx="14.3" cy="13.7" r="2.2" />
    </>
  ),
  album: (
    <>
      <circle cx="10" cy="10" r="7.5" />
      <circle cx="10" cy="10" r="2.2" />
    </>
  ),
  artist: (
    <>
      <circle cx="10" cy="6.8" r="3.6" />
      <path d="M3.2 17.2c.7-3.6 3.4-5.4 6.8-5.4s6.1 1.8 6.8 5.4" />
    </>
  ),
  compare: (
    <>
      <circle cx="7.3" cy="10" r="5.3" />
      <circle cx="12.7" cy="10" r="5.3" />
    </>
  ),
  mix: <path d="M5 3v14M10 3v14M15 3v14M3 13h4M8 6.5h4M13 11h4" />,
  camera: (
    <>
      <rect x="2.5" y="5" width="10.5" height="10" rx="2.5" />
      <path d="M13 9l4.5-2.5v7L13 11z" />
    </>
  ),
  mic: (
    <>
      <rect x="7.5" y="2.5" width="5" height="9.5" rx="2.5" />
      <path d="M4.5 9.5a5.5 5.5 0 0011 0M10 15v2.5" />
    </>
  ),
  list: (
    <>
      <path d="M3 5.5h10M3 10h10M3 14.5h5" />
      <path d="M13 15.5V9.5l4-1" />
      <circle cx="11.6" cy="15.5" r="1.4" />
    </>
  ),
  gear: (
    <>
      <circle cx="10" cy="10" r="2.6" />
      <path d="M10 2.5v2.2M10 15.3v2.2M2.5 10h2.2M15.3 10h2.2M4.7 4.7l1.6 1.6M13.7 13.7l1.6 1.6M15.3 4.7l-1.6 1.6M6.3 13.7l-1.6 1.6" />
    </>
  ),
  sun: (
    <>
      <circle cx="10" cy="10" r="3.4" />
      <path d="M10 2.5v1.8M10 15.7v1.8M2.5 10h1.8M15.7 10h1.8M4.7 4.7l1.3 1.3M14 14l1.3 1.3M15.3 4.7L14 6M6 14l-1.3 1.3" />
    </>
  ),
  moon: <path d="M16.5 12.2A7 7 0 017.8 3.5a7 7 0 108.7 8.7z" />,
  shuffle: <path d="M2.5 6h3c4 0 5 8 9 8h3M2.5 14h3c1.4 0 2.4-1 3.2-2.2M11.3 8.2C12.1 7 13.1 6 14.5 6h3M15.5 3.5L18 6l-2.5 2.5M15.5 11.5L18 14l-2.5 2.5" />,
  repeat: <path d="M4 9V8a3 3 0 013-3h9.5M14 2.5L16.5 5 14 7.5M16 11v1a3 3 0 01-3 3H3.5M6 12.5L3.5 15 6 17.5" />,
  volume: (
    <>
      <path d="M3 7.8v4.4h2.8L10 16V4L5.8 7.8z" fill="currentColor" />
      <path d="M13 7.2a4 4 0 010 5.6M15.2 5a7 7 0 010 10" />
    </>
  ),
  spectrum: <path d="M3 16v-3M6.5 16V9M10 16V4M13.5 16v-6M17 16v-3.5" />,
  columns: (
    <>
      <rect x="3" y="4" width="14" height="12" rx="2.5" />
      <path d="M8 4v12M12.5 4v12" />
    </>
  ),
  trash: <path d="M3.5 5.5h13M8 5.5V3.5h4v2M5 5.5l.8 11h8.4l.8-11" />,
  star: <path d="M10 2.8l2.2 4.7 5.1.6-3.8 3.5 1 5.1-4.5-2.5-4.5 2.5 1-5.1L2.7 8.1l5.1-.6z" fill="currentColor" />,
  warn: <path d="M10 3L2 16.5h16zM10 8.5v3.8M10 14.5v.2" />
}

export default function Icon({ name, size }: { name: string; size?: number }): React.ReactNode {
  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {P[name]}
    </svg>
  )
}
