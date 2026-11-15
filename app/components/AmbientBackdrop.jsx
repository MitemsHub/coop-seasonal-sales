// app/components/AmbientBackdrop.jsx
// Lightweight ambient page backdrop. Uses layered CSS gradients instead of a
// second WebGL canvas so the exhibition shop stays cheap on low-end phones.

export default function AmbientBackdrop({ variant = 'shop' }) {
  const isCoop = variant === 'coop'

  return (
    <div
      aria-hidden="true"
      className={`ambient-backdrop ${isCoop ? 'ambient-backdrop--coop' : 'ambient-backdrop--shop'}`}
    >
      <div className="ambient-backdrop__wash" />
      <div className="ambient-backdrop__grid" />
    </div>
  )
}
