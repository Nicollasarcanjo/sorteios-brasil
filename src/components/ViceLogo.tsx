import React from 'react';

export function ViceEmblem({className = 'w-40 h-auto'}: {className?: string}) {
  return (
    <svg
      viewBox="0 0 280 180"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Emblema VI Leonida"
    >
      <defs>
        <linearGradient id="viceSunsetGrad" x1="0" y1="0" x2="280" y2="180" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FF4E8E" />
          <stop offset="52%" stopColor="#FF8C42" />
          <stop offset="100%" stopColor="#FFD166" />
        </linearGradient>
        <linearGradient id="viceDarkBevel" x1="0" y1="0" x2="0" y2="180" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#1B1328" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#0B0A10" stopOpacity="0.85" />
        </linearGradient>
      </defs>

      {/* Roman Numeral VI */}
      <path
        d="M28 24H76L108 124L140 24H186L134 156H82L28 24Z"
        fill="url(#viceSunsetGrad)"
      />
      <path
        d="M204 24H250V156H204V24Z"
        fill="url(#viceSunsetGrad)"
      />

      {/* Palm Tree Silhouette inside V/I negative horizon */}
      <g fill="#0B0A10" opacity="0.92">
        <path d="M164 156C166 130 171 106 180 86C183 80 186 80 185 88C179 109 175 132 174 156H164Z" />
        <path d="M180 84C166 74 148 75 136 84C149 82 164 84 176 90L180 84Z" />
        <path d="M181 82C168 67 152 60 137 64C151 67 166 74 178 86L181 82Z" />
        <path d="M183 82C185 65 178 49 166 41C173 53 177 68 179 84L183 82Z" />
        <path d="M184 83C196 68 212 61 226 64C212 68 198 75 186 87L184 83Z" />
        <path d="M185 85C201 77 219 79 231 89C217 85 201 86 187 91L185 85Z" />
      </g>

      {/* Subtle architectural scanline */}
      <rect x="28" y="24" width="222" height="132" fill="url(#viceDarkBevel)" style={{mixBlendMode: 'soft-light'}} />
    </svg>
  );
}
