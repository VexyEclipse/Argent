// Single-weight line icon set (24px grid, 1.75 stroke) so every glyph matches.

const PATHS = {
  play: <path d="M7 4.8v14.4a.8.8 0 0 0 1.2.7l11.4-7.2a.8.8 0 0 0 0-1.4L8.2 4.1A.8.8 0 0 0 7 4.8Z" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none" />
      <rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 7.6v.1" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  heart: <path d="M12 20s-7.5-4.6-7.5-10.1A4.4 4.4 0 0 1 12 7.1a4.4 4.4 0 0 1 7.5 2.8C19.5 15.4 12 20 12 20Z" />,
  heartFilled: <path d="M12 20s-7.5-4.6-7.5-10.1A4.4 4.4 0 0 1 12 7.1a4.4 4.4 0 0 1 7.5 2.8C19.5 15.4 12 20 12 20Z" fill="currentColor" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </>
  ),
  home: <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1v-8.5Z" />,
  film: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M7.5 4.5v15M16.5 4.5v15M3.5 9h4M3.5 15h4M16.5 9h4M16.5 15h4" />
    </>
  ),
  tv: (
    <>
      <rect x="3" y="5.5" width="18" height="12" rx="2" />
      <path d="M8 21h8M9 2.5l3 3 3-3" />
    </>
  ),
  stack: (
    <>
      <rect x="4" y="8" width="16" height="12" rx="2" />
      <path d="M6.5 5h11M9 2.5h6" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.5" r="3.8" />
      <path d="M4.5 20c.9-3.8 3.9-5.8 7.5-5.8s6.6 2 7.5 5.8" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 13.5a7.7 7.7 0 0 0 0-3l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.5A7.6 7.6 0 0 0 7 6.5l-2.4-1-2 3.4 2 1.6a7.7 7.7 0 0 0 0 3l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.6 7.6 0 0 0 2.6-1.5l2.4 1 2-3.4-2-1.6Z" />
    </>
  ),
  chevronLeft: <path d="m14.5 5-7 7 7 7" />,
  chevronRight: <path d="m9.5 5 7 7-7 7" />,
  chevronDown: <path d="m5 9.5 7 7 7-7" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  volume: (
    <>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
    </>
  ),
  volumeOff: (
    <>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      <path d="m16 9.5 5 5M21 9.5l-5 5" />
    </>
  ),
  subtitles: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 12.5h3M13 12.5h4M7 15.5h6M15.5 15.5H17" />
    </>
  ),
  audio: (
    <>
      <path d="M4 14v-3M8 17V8M12 20V5M16 16V9M20 13v-1" />
    </>
  ),
  fullscreen: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  fullscreenExit: <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />,
  replay10: (
    <>
      <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
      <path d="M4.5 4.5v3h3" />
      <text x="12" y="15.3" fontSize="7" textAnchor="middle" fill="currentColor" stroke="none" fontWeight="600">
        10
      </text>
    </>
  ),
  forward10: (
    <>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
      <path d="M19.5 4.5v3h-3" />
      <text x="12" y="15.3" fontSize="7" textAnchor="middle" fill="currentColor" stroke="none" fontWeight="600">
        10
      </text>
    </>
  ),
  skipNext: (
    <>
      <path d="M6 5.5v13l9-6.5z" fill="currentColor" stroke="none" />
      <path d="M18 5.5v13" />
    </>
  ),
  skipPrev: (
    <>
      <path d="M18 5.5v13l-9-6.5z" fill="currentColor" stroke="none" />
      <path d="M6 5.5v13" />
    </>
  ),
  star: <path d="m12 3.8 2.5 5.1 5.6.8-4 3.9 1 5.6-5.1-2.6-5 2.6 1-5.6-4.1-3.9 5.6-.8z" fill="currentColor" stroke="none" />,
  grid: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </>
  ),
  sliders: <path d="M4 7h10M18 7h2M4 17h4M12 17h8M16 4.5v5M10 14.5v5" />,
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M3 3l18 18M10.6 5.6A9.7 9.7 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.8 3.6M6.6 6.6C4 8.3 2.5 12 2.5 12S6 18.5 12 18.5a9.4 9.4 0 0 0 4.2-1" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </>
  ),
  thumbsDown: <path d="M16 4.5h3a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-3m0-9v9l-3.6 6.2a1.6 1.6 0 0 1-2.9-1.2l.9-3.5H5.6a2 2 0 0 1-2-2.4l1.3-6A2 2 0 0 1 6.8 4.5z" />,
  shuffle: <path d="M4 7h3.5c4.5 0 4.5 10 9 10H20M4 17h3.5c1.6 0 2.6-1.3 3.4-3M13 10c.8-1.7 1.9-3 3.5-3H20M17.5 4.5 20 7l-2.5 2.5M17.5 14.5 20 17l-2.5 2.5" />,
  speed: (
    <>
      <path d="M4.5 16.5a8 8 0 1 1 15 0" />
      <path d="m12 13 3.5-4" />
    </>
  ),
  pip: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <rect x="12" y="11.5" width="6.5" height="5" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  logout: <path d="M14 4.5H6a1.5 1.5 0 0 0-1.5 1.5v12A1.5 1.5 0 0 0 6 19.5h8M10 12h10.5M17 8.5l3.5 3.5-3.5 3.5" />,
  dashboard: (
    <>
      <rect x="4" y="4" width="7" height="9" rx="1.5" />
      <rect x="13" y="4" width="7" height="5" rx="1.5" />
      <rect x="13" y="11" width="7" height="9" rx="1.5" />
      <rect x="4" y="15" width="7" height="5" rx="1.5" />
    </>
  ),
  sparkle: (
    <path d="M12 3.5c.6 4.4 2.1 5.9 6.5 6.5-4.4.6-5.9 2.1-6.5 6.5-.6-4.4-2.1-5.9-6.5-6.5 4.4-.6 5.9-2.1 6.5-6.5ZM18.5 15.5c.3 1.9.9 2.6 2.8 2.8-1.9.3-2.5.9-2.8 2.8-.3-1.9-.9-2.5-2.8-2.8 1.9-.2 2.5-.9 2.8-2.8Z" />
  ),
  compass: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5-5 2 2-5z" />
    </>
  ),
  list: <path d="M8.5 6.5H20M8.5 12H20M8.5 17.5H20M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" />,
  external: <path d="M14 4.5h5.5V10M19.5 4.5 11 13M18 14v4.5a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1H10" />,
  swap: <path d="M7 4.5 4 7.5l3 3M4 7.5h12M17 13.5l3 3-3 3M20 16.5H8" />,
  download: <path d="M12 4.5v11M7.5 11l4.5 4.5 4.5-4.5M5 19.5h14" />,
  upload: <path d="M12 19.5v-11M7.5 13 12 8.5l4.5 4.5M5 4.5h14" />,
  pin: <path d="M9 4.5h6M10 4.5v5.5l-3 3.5h10l-3-3.5V4.5M12 14v6" />,
  copy: (
    <>
      <rect x="9" y="9" width="10.5" height="10.5" rx="2" />
      <path d="M15 9V6a1.5 1.5 0 0 0-1.5-1.5h-7.5A1.5 1.5 0 0 0 4.5 6v7.5A1.5 1.5 0 0 0 6 15h3" />
    </>
  ),
  bell: <path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 2h-14l1.5-2ZM10 20.5a2 2 0 0 0 4 0" />,
  bellFilled: (
    <>
      <path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 2h-14l1.5-2Z" fill="currentColor" />
      <path d="M10 20.5a2 2 0 0 0 4 0" />
    </>
  ),
  sound: <path d="M4.5 10v4M8.5 7v10M12.5 4.5v15M16.5 8v8M20 10.5v3" />,
  bookmark: <path d="M6.5 4.5h11a1 1 0 0 1 1 1v14l-6.5-4-6.5 4v-14a1 1 0 0 1 1-1Z" />,
  bookmarkFilled: <path d="M6.5 4.5h11a1 1 0 0 1 1 1v14l-6.5-4-6.5 4v-14a1 1 0 0 1 1-1Z" fill="currentColor" />,
  calendar: (
    <>
      <rect x="4" y="5.5" width="16" height="14" rx="2" />
      <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
    </>
  ),
  more: <path d="M6 12h.01M12 12h.01M18 12h.01" strokeWidth={3} />,
  pencil: <path d="M4.5 19.5h4l10-10a2.1 2.1 0 0 0-3-3l-10 10v3ZM13.5 8.5l2 2" />,
  trash: <path d="M5 7h14M10 7V5h4v2M7 7l1 12.5h8L17 7M10.5 11v5M13.5 11v5" />,
  refresh: <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4" />,
  select: (
    <>
      <rect x="4.5" y="4.5" width="15" height="15" rx="3" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </>
  ),
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
  checkAll:<path d="m2.5 12.5 4.5 4.5 9.5-9.5M11.5 16.5l.5.5 9.5-9.5" />,
  image: (
    <>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="m4.5 16.5 4.5-4.5 3.5 3.5 2.5-2.5 4.5 4.5M15 9.5h.01" />
    </>
  ),
  cast: (
    <>
      <path d="M3.5 8V6.5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H14" />
      <path d="M3.5 12a8 8 0 0 1 8 8M3.5 15.5a4.5 4.5 0 0 1 4.5 4.5M3.5 19.5h.01" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8.5" r="3.5" />
      <path d="M3 19.5a6 6 0 0 1 12 0M16 5.2a3.5 3.5 0 0 1 0 6.6M18 14.2a6 6 0 0 1 3 5.3" />
    </>
  ),
  remote: (
    <>
      <rect x="7.5" y="2.5" width="9" height="19" rx="3" />
      <circle cx="12" cy="8" r="2" />
      <path d="M10.5 13.5h.01M13.5 13.5h.01M10.5 16.5h.01M13.5 16.5h.01" />
    </>
  ),
  stop: <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none" />,
  layers: <path d="m12 4 8.5 4.5L12 13 3.5 8.5 12 4ZM3.5 12.5 12 17l8.5-4.5M3.5 16.5 12 21l8.5-4.5" />,
  bug: (
    <>
      <rect x="7.5" y="7.5" width="9" height="12" rx="4.5" />
      <path d="M9 7.5a3 3 0 0 1 6 0M12 11v8.5M4 13h3.5M16.5 13H20M5 8.5l2.8 1.5M19 8.5l-2.8 1.5M5 18l2.8-1.5M19 18l-2.8-1.5" />
    </>
  ),
  arrowUp: <path d="M12 19V5M6 11l6-6 6 6" />,
  arrowDown: <path d="M12 5v14M6 13l6 6 6-6" />,
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, className, title }: { name: IconName; size?: number; className?: string; title?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title && <title>{title}</title>}
      {PATHS[name]}
    </svg>
  );
}
