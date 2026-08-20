export function OriginalNetworkIllustration() {
  return (
    <svg
      aria-label="虚构营业网络插画"
      className="network-illustration"
      role="img"
      viewBox="0 0 900 620"
    >
      <defs>
        <linearGradient id="platform" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#2879ea" />
          <stop offset="1" stopColor="#3153d9" />
        </linearGradient>
        <linearGradient id="tower" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#f7fbff" />
          <stop offset="1" stopColor="#cfe7ff" />
        </linearGradient>
        <filter id="shadow" height="160%" width="160%" x="-30%" y="-30%">
          <feDropShadow dx="0" dy="15" floodColor="#1733a1" floodOpacity=".32" stdDeviation="12" />
        </filter>
      </defs>

      <path
        d="M100 370 435 175l350 200-335 196Z"
        fill="url(#platform)"
        filter="url(#shadow)"
      />
      <path d="M100 370v48l350 199v-46Z" fill="#2147c6" opacity=".7" />
      <path d="m450 571 335-196v45L450 617Z" fill="#173cb6" opacity=".78" />

      <g fill="none" stroke="#87d5ff" strokeDasharray="7 10" strokeLinecap="round" strokeWidth="3">
        <path d="M220 381c75 5 109-38 162-70" />
        <path d="M469 285c90 4 145 45 210 102" />
        <path d="M428 408c-8 58-63 82-108 102" />
      </g>

      <g transform="translate(365 160)" filter="url(#shadow)">
        <path d="m0 68 98-57 108 62-101 59Z" fill="#fff" />
        <path d="M0 68v190l105 61V132Z" fill="url(#tower)" />
        <path d="m105 132 101-59v187l-101 59Z" fill="#aacfff" />
        <path d="m28 92 50 29v12l-50-29Zm0 35 50 29v12l-50-29Zm0 35 50 29v12l-50-29Zm0 35 50 29v12l-50-29Z" fill="#3f83ed" />
        <path d="m128 144 53-31v18l-53 31Zm0 38 53-31v18l-53 31Zm0 38 53-31v18l-53 31Z" fill="#fff" opacity=".86" />
        <path d="m78 6 35-20 38 22-37 22Z" fill="#ffb540" />
      </g>

      <g transform="translate(155 320)" filter="url(#shadow)">
        <path d="m0 58 88-51 97 56-91 53Z" fill="#f7fbff" />
        <path d="M0 58v87l94 55v-84Z" fill="#d9edff" />
        <path d="m94 116 91-53v85l-91 52Z" fill="#9ec9ff" />
        <path d="m18 91 57 33v25l-57-33Z" fill="#2f6ee3" />
        <path d="m130 94 28-16v41l-28 16Z" fill="#ffb540" />
      </g>

      <g transform="translate(615 330)" filter="url(#shadow)">
        <path d="m0 49 74-43 85 49-78 45Z" fill="#fff" />
        <path d="M0 49v80l81 47v-76Z" fill="#d4eaff" />
        <path d="m81 100 78-45v77l-78 44Z" fill="#9ac7ff" />
        <path d="m25 84 39 22v18l-39-22Z" fill="#2f6ee3" />
      </g>

      <g transform="translate(560 458)" filter="url(#shadow)">
        <path d="m0 42 72-42 94 54-73 43Z" fill="#f9fcff" />
        <path d="M0 42v44l93 54V97Z" fill="#cce6ff" />
        <path d="m93 97 73-43v43l-73 43Z" fill="#87bbff" />
        <path d="m35 50 45 26 39-23-45-26Z" fill="#ffb540" />
      </g>

      <g fill="#ff9d2f">
        <circle cx="286" cy="306" r="11" />
        <circle cx="674" cy="396" r="11" />
        <circle cx="425" cy="455" r="11" />
      </g>
      <g fill="#fff">
        <path d="m277 306 8-7v5h9v4h-9v5Z" />
        <path d="m665 396 8-7v5h9v4h-9v5Z" />
        <path d="m416 455 8-7v5h9v4h-9v5Z" />
      </g>

      <g transform="translate(434 86)">
        <path d="M29 60C12 60 0 49 0 34 0 18 13 7 28 8 36-4 57-3 64 13c18-1 31 10 31 25 0 13-10 22-24 22Z" fill="none" stroke="#c7ecff" strokeWidth="7" />
        <path d="m33 35 14-13v9h16v8H47v9Z" fill="#c7ecff" />
      </g>
    </svg>
  )
}
