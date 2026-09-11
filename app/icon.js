// app/icon.js
// Next.js App Router auto-generates favicon + <link> tags from this file.
// Serves the existing logo.png as the site icon with a branded fallback.
import { ImageResponse } from 'next/og'

export const runtime = 'nodejs'
export const size = { width: 100, height: 100 }
export const contentType = 'image/png'

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#1d6746',
          borderRadius: '20%',
        }}
      >
        <span
          style={{
            color: 'white',
            fontSize: '34px',
            fontWeight: '800',
            fontFamily: 'system-ui, sans-serif',
            letterSpacing: '1px',
          }}
        >
          CBN
        </span>
        <span
          style={{
            color: '#dbf2e4',
            fontSize: '12px',
            fontWeight: '600',
            fontFamily: 'system-ui, sans-serif',
            letterSpacing: '0.5px',
            marginTop: '-2px',
          }}
        >
          COOP
        </span>
      </div>
    ),
    size,
  )
}
