// app/components/ExhibitionShowcase.jsx
// Photo gallery section on the landing page showcasing the real Coop Exhibition.
// Images adapt to light/dark mode via CSS filters and feature hover overlays
// with category labels. Uses the Reveal component for scroll-triggered fade-in.
'use client'

import { motion, useReducedMotion } from 'framer-motion'
import Reveal from './ui/Reveal'

const EXHIBITION_PHOTOS = [
  {
    src: '/landing/photos/exhibition-food-rice.jpg',
    alt: 'Exhibition food distribution — Gerawa premium rice and Unza classic rice stacked under canopy',
    label: 'Food Distribution',
    span: 'col-span-1 row-span-1 sm:col-span-2 sm:row-span-2',
  },
  {
    src: '/landing/photos/exhibition-clothing.jpg',
    alt: 'Exhibition clothing stands — colourful dresses and traditional wear on display under yellow canopies',
    label: 'Fashion & Clothing',
    span: 'col-span-1 row-span-1',
  },
  {
    src: '/landing/photos/exhibition-cars.jpg',
    alt: 'Exhibition car showcase — red Kia and other vehicles displayed under white canopy tent',
    label: 'Automobiles',
    span: 'col-span-1 row-span-1',
  },
  {
    src: '/landing/photos/exhibition-fabrics-shoes.jpg',
    alt: 'Exhibition fabrics and shoes — vibrant Ankara fabrics, headwraps and footwear on display',
    label: 'Fabrics & Footwear',
    span: 'col-span-1 row-span-1',
  },
  {
    src: '/landing/photos/exhibition-home-decor.jpg',
    alt: 'Exhibition home decor — pillows, wall art, furniture and decorative items under canopy',
    label: 'Home & Living',
    span: 'col-span-1 row-span-1',
  },
  {
    src: '/landing/photos/exhibition-food-maggi.jpg',
    alt: 'Exhibition food distribution — stacked Maggi seasoning and Milo beverage cartons',
    label: 'Groceries & Beverages',
    span: 'col-span-1 row-span-1 sm:col-span-2',
  },
  {
    src: '/landing/photos/exhibition-food-golden-morn.jpg',
    alt: 'Exhibition food distribution — Golden Morn cereal cartons stacked in bulk',
    label: 'Cereals & Grains',
    span: 'col-span-1 row-span-1',
  },
]

function PhotoCard({ photo, index }) {
  const reduce = useReducedMotion()

  return (
    <Reveal delay={index * 0.06} className={photo.span}>
      <motion.div
        className="group relative h-full overflow-hidden rounded-xl border border-line bg-surface shadow-xs"
        whileHover={reduce ? undefined : { y: -4, boxShadow: '0 12px 40px -8px rgba(0,0,0,0.15)' }}
        transition={{ duration: 0.25, ease: [0.21, 0.47, 0.32, 0.98] }}
      >
        {/* The image — CSS class handles light/dark adaptive filtering */}
        <div className="exhibition-photo-wrapper relative h-full min-h-[12rem] overflow-hidden">
          <img
            src={photo.src}
            alt={photo.alt}
            loading="lazy"
            draggable={false}
            className="exhibition-photo h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
          />

          {/* Dark overlay gradient — intensifies on hover */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent opacity-60 transition-opacity duration-300 group-hover:opacity-80" />

          {/* Category label — slides up on hover */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 p-4">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-white backdrop-blur-sm transition-all duration-300 group-hover:bg-white/30 group-hover:translate-y-0 translate-y-1">
              {photo.label}
            </span>
          </div>

          {/* Shimmer effect on hover */}
          <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100">
            <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
          </div>
        </div>
      </motion.div>
    </Reveal>
  )
}

export default function ExhibitionShowcase() {
  return (
    <section className="scroll-mt-20 border-t border-line">
      <div className="mx-auto max-w-7xl px-4 py-16 lg:px-6 lg:py-24">
        <Reveal className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold uppercase tracking-wider text-brand">
            Real Moments
          </span>
          <h2 className="mt-4 text-h1 font-bold tracking-tight text-fg">
            See the Coop Exhibition in action
          </h2>
          <p className="mt-3 text-sm leading-6 text-fg/80 sm:text-base">
            From food distribution to fashion, automobiles to home decor — real photos from our branches nationwide.
          </p>
        </Reveal>

        {/* Photo grid — masonry-like layout */}
        <div className="mt-10 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 auto-rows-[minmax(12rem,1fr)]">
          {EXHIBITION_PHOTOS.map((photo, i) => (
            <PhotoCard key={photo.src} photo={photo} index={i} />
          ))}
        </div>
      </div>
    </section>
  )
}
