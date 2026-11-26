'use client'

// app/components/StandCard.jsx
// The stand card used by the exhibition shop's featured rail and the full
// stands directory, so a stand looks the same wherever a member meets it: a
// coloured or photographic banner, its monogram, name, the shelves it sells
// from, its pitch, a strip of what is on the stand today, and where to find it.
//
// Kept as one component rather than two so the two surfaces cannot drift.
import { useRouter } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import { thumbSrcSet, thumbUrl } from '../../lib/imageUrl'
import { initials } from '../../lib/exhibitionStands'
import { vendorAboutLine, vendorShelfLabels } from '../../lib/exhibitionShelf'

const PLACEHOLDER = '/images/items/placeholder.svg'
const THUMBS = 3

// A stable colour per business, so a stand without a banner still has its own
// identity rather than the same grey-green wash as every other.
function hueOf(name) {
  let h = 0
  const s = String(name || '')
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 360
  return h
}

export default function StandCard({
  v,
  count = 0,
  products = [],
  shelfLabels,
  index = 0,
  className = '',
}) {
  const router = useRouter()
  // Up to three shelves, best first. Callers that know the stand's products
  // pass labels already ordered by how many land on each; others fall back to
  // the stand's declaration.
  const labels = (shelfLabels?.length ? shelfLabels : vendorShelfLabels(v)).slice(0, 3)
  const about = vendorAboutLine(v)
  const hue = hueOf(v.name)
  const thumbs = products.filter((p) => p.image_url || p.images?.length).slice(0, THUMBS)

  return (
    <button
      type="button"
      data-hub-card
      onClick={() => router.push(`/exhibition/vendor/${v.id}`)}
      aria-label={`Open ${v.name} stand — ${count} product${count === 1 ? '' : 's'}`}
      style={{ animationDelay: `${Math.min(index, 7) * 55}ms` }}
      // No hover lift: this card also lives inside an overflow-x rail, where a
      // lifted top edge gets clipped. Border, shadow and the banner zoom carry
      // the hover instead.
      className={`rise-in group relative flex h-full w-full flex-col overflow-hidden rounded-2xl border border-line bg-surface text-left shadow-sm transition-[border-color,box-shadow] duration-300 ease-sakani hover:border-accent hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${className}`}
    >
      {/* Stand header — banner, or a colour drawn from the vendor's name */}
      <span className="relative block h-20 w-full overflow-hidden">
        {v.banner_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbUrl(v.banner_url, 800)}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 ease-sakani group-hover:scale-110"
          />
        ) : (
          <>
            <span
              className="absolute inset-0"
              aria-hidden="true"
              style={{
                background: `linear-gradient(125deg, hsl(${hue} 45% 92%), hsl(${(hue + 38) % 360} 42% 73%))`,
              }}
            />
            <span
              className="absolute inset-0 opacity-20"
              aria-hidden="true"
              style={{
                backgroundImage: 'radial-gradient(currentColor 1px, transparent 1px)',
                backgroundSize: '11px 11px',
                color: '#0f172a',
              }}
            />
            <span
              className="absolute -bottom-6 right-1 select-none text-[4.75rem] font-black leading-none tracking-tighter text-white/55 transition-transform duration-500 ease-sakani group-hover:scale-105"
              aria-hidden="true"
            >
              {initials(v.name)}
            </span>
          </>
        )}
        <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-fg/25 via-transparent to-transparent" aria-hidden="true" />
        {/* Sheen — the small sign of life a static tile does not have. */}
        <span
          className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 -skew-x-12 bg-white/30 blur-md transition-transform duration-700 ease-sakani group-hover:translate-x-[420%]"
          aria-hidden="true"
        />
        {!!v.stand_number && (
          <span className="absolute right-2 top-2 rounded-full bg-surface/90 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-fg shadow-sm backdrop-blur">
            Stand {v.stand_number}
          </span>
        )}
      </span>

      {/* Monogram + product count, overlapping the header */}
      <span className="relative -mt-5 flex items-end px-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border-2 border-surface bg-surface text-[11px] font-black text-brand shadow-sm ring-1 ring-line-subtle transition-colors duration-300 group-hover:bg-accent-subtle group-hover:text-accent">
          {initials(v.name)}
        </span>
        <span className="ml-auto mb-1 inline-flex items-center gap-1 rounded-full bg-accent-subtle px-2 py-0.5 text-[10px] font-semibold text-accent">
          {count} product{count === 1 ? '' : 's'}
        </span>
      </span>

      <span className="flex flex-1 flex-col px-3 pb-3 pt-2">
        <span className="block truncate text-sm font-bold tracking-tight text-fg">{v.name}</span>
        <span className="mt-0.5 block truncate text-[10px] font-semibold uppercase tracking-wide text-brand">
          {labels.join(' · ') || 'Exhibition stand'}
        </span>
        <span className="mt-1 line-clamp-2 min-h-[2.2rem] break-words text-[11px] leading-snug text-muted">
          {about || v.address || 'A stand at this season’s exhibition.'}
        </span>

        {thumbs.length > 0 && (
          <span className="mt-2 flex items-center gap-1">
            {thumbs.map((p) => (
              <span
                key={p.id}
                className="h-8 w-8 shrink-0 overflow-hidden rounded-md border border-line-subtle bg-white"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={thumbUrl(p.image_url || p.images?.[0] || PLACEHOLDER, 160)}
                  srcSet={thumbSrcSet(p.image_url || p.images?.[0] || PLACEHOLDER, 160)}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform duration-300 ease-sakani group-hover:scale-105"
                  onError={(e) => { e.currentTarget.src = PLACEHOLDER }}
                />
              </span>
            ))}
            {count > thumbs.length && (
              <span className="pl-0.5 text-[10px] font-semibold text-muted">+{count - thumbs.length}</span>
            )}
          </span>
        )}

        <span className="mt-auto flex items-center justify-between gap-2 border-t border-line-subtle pt-2">
          <span className="truncate text-[10px] text-muted">{v.hall || v.address || 'Exhibition stand'}</span>
          <span className="inline-flex shrink-0 items-center gap-0.5 text-[10px] font-bold text-brand">
            Visit
            <ChevronRight className="h-3 w-3 transition-transform duration-300 ease-sakani group-hover:translate-x-0.5" />
          </span>
        </span>
      </span>
    </button>
  )
}
