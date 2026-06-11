import { ImageResponse } from 'next/og'

export const alt = 'SIMAS — Sistema jurídico inteligente com IA'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const MARK =
  'data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 24 24" fill="none"><path d="M5.5 8h13" stroke="#D4A93C" stroke-width="1.6" stroke-linecap="round"/><path d="M12 6v13M8.5 19.5h7" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="5" r="1.5" fill="#D4A93C"/><path d="M6 8l-2.3 3.6M6 8l2.3 3.6M18 8l-2.3 3.6M18 8l2.3 3.6" stroke="#fff" stroke-width="1.05" stroke-linecap="round" opacity="0.8"/><path d="M3 11.6a3 3 0 0 0 6 0Z" fill="#D4A93C" fill-opacity="0.92"/><path d="M15 11.6a3 3 0 0 0 6 0Z" fill="#D4A93C" fill-opacity="0.92"/></svg>`,
  )

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '90px',
          background: 'linear-gradient(135deg, #16263E 0%, #2A3E5F 55%, #3F5B86 100%)',
          color: 'white',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={MARK} width={84} height={84} alt="" />
          <span style={{ marginLeft: 22, fontSize: 52, fontWeight: 800, letterSpacing: -1 }}>SIMAS</span>
        </div>

        <div style={{ display: 'flex', width: 96, height: 5, background: '#D4A93C', borderRadius: 9, margin: '44px 0 30px' }} />

        <div style={{ display: 'flex', fontSize: 66, fontWeight: 800, lineHeight: 1.12, maxWidth: 940, letterSpacing: -1.5 }}>
          A advocacia do futuro, agora no seu escritório
        </div>

        <div style={{ display: 'flex', marginTop: 28, fontSize: 30, color: 'rgba(255,255,255,0.72)', maxWidth: 900, lineHeight: 1.4 }}>
          Analise casos com IA, gere peças processuais e organize o escritório — em minutos.
        </div>
      </div>
    ),
    { ...size },
  )
}
