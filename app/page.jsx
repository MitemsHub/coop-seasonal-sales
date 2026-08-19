'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Beef,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  HandCoins,
  Mail,
  MapPin,
  Phone,
  PiggyBank,
  Quote,
  ShoppingBasket,
  Star,
  Store,
  Truck,
  Users,
} from 'lucide-react'
import LandingHeader, { SIGNUP_URL } from './components/LandingHeader'
import Reveal from './components/ui/Reveal'

/* ---------------------------------------------------------------- */
/*  Section heading pattern                                           */
/* ---------------------------------------------------------------- */
function SectionHeading({ kicker, title, description }) {
  return (
    <Reveal className="mx-auto max-w-2xl text-center">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold uppercase tracking-wider text-brand">
        {kicker}
      </span>
      <h2 className="mt-4 text-h1 font-bold tracking-tight text-fg">
        {title}
      </h2>
      {description && (
        <p className="mt-3 text-sm leading-6 text-fg/80 sm:text-base">{description}</p>
      )}
    </Reveal>
  )
}

/* ---------------------------------------------------------------- */
/*  Hero — a full-bleed photo backdrop that crossfades on its own     */
/*  The copy sits on the left over a canvas fade; the photo shows     */
/*  through on the right and changes automatically.                   */
/* ---------------------------------------------------------------- */
const HERO_IMAGES = [
  '/landing/photos/hero-logistics.jpg',
  '/landing/photos/hero-ram.jpg',
  '/landing/photos/hero-community.jpg',
  '/landing/photos/hero-04.jpg',
  '/landing/photos/hero-05.jpg',
  '/landing/photos/hero-06.jpg',
  '/landing/photos/hero-07.jpg',
  '/landing/photos/hero-08.jpg',
  '/landing/photos/hero-09.jpg',
  '/landing/photos/hero-10.jpg',
  '/landing/photos/hero-11.jpg',
  '/landing/photos/hero-12.jpg',
  '/landing/photos/hero-13.jpg',
  '/landing/photos/hero-15.jpg',
]

const FILM_GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)' opacity='0.55'/%3E%3C/svg%3E\")"

/* ---------------------------------------------------------------- */
/*  Rotating category word — the noun in the first hero line animates  */
/*  from 'food' into the other things the Coop moves.                 */
/* ---------------------------------------------------------------- */
const CATEGORY_WORDS = [
  'food',
  'cars',
  'groceries',
  'beverages',
  'clothes',
  'furniture',
  'solar panels',
  'accessories',
  'appliances',
  'textiles',
  "men's wear",
  "women's wear",
  "children's wear",
]

function RotatingHeroWord() {
  const reduce = useReducedMotion()
  const [i, setI] = useState(0)
  const ROTATE_MS = 2800

  useEffect(() => {
    if (reduce) return
    const id = setInterval(() => setI((v) => (v + 1) % CATEGORY_WORDS.length), ROTATE_MS)
    return () => clearInterval(id)
  }, [reduce, ROTATE_MS])

  const word = CATEGORY_WORDS[i]

  return (
    <span className="relative inline-flex text-brand">
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={word}
          initial={{ opacity: 0, y: 10, filter: 'blur(4px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: -10, filter: 'blur(4px)' }}
          transition={{ duration: 0.3, ease: [0.33, 1, 0.68, 1] }}
        >
          {word}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

function PhotoHero() {
  const reduce = useReducedMotion()
  const [slide, setSlide] = useState(0)
  const [paused, setPaused] = useState(false)
  // Per-slide readiness — a photo never fades in until it's actually decoded,
  // so the hero can't flash a blank or a "loading" state at any point.
  const [ready, setReady] = useState({})
  const markReady = (i) => setReady((r) => (r[i] ? r : { ...r, [i]: true }))
  const imgRef = useRef(null)
  const COUNT = HERO_IMAGES.length
  const AUTOPLAY_MS = 4000

  // Cached photos can fire `load` synchronously during React's commit, before its
  // delegated onLoad listener is ready — which silently leaves a slide invisible.
  // If the incoming photo is already decoded (preloaded), mark it ready here;
  // onLoad/onError below cover the genuinely-uncached case.
  useEffect(() => {
    if (imgRef.current && imgRef.current.complete) markReady(slide)
  }, [slide])

  // Preload only the upcoming photos so crossfades are instant — a couple ahead,
  // not all 14 at once. Preloading everything at mount splits the first image's
  // eager load across 14 parallel downloads, which on a slow connection is what
  // made the hero sit blank ("loader"-like) before the first photo appeared.
  // Preloading isn't motion, so it runs for everyone — reduced-motion users who
  // navigate with the arrows get the same instant, flash-free crossfades.
  useEffect(() => {
    const ahead = [slide + 1, slide + 2, slide - 1]
    ahead.forEach((i) => {
      const img = new Image()
      img.src = HERO_IMAGES[(i + HERO_IMAGES.length) % HERO_IMAGES.length]
    })
  }, [slide])

  // Auto-advance the backdrop, pausing on hover/focus and for reduced-motion users.
  useEffect(() => {
    if (reduce || paused) return
    const id = setInterval(() => setSlide((s) => (s + 1) % COUNT), AUTOPLAY_MS)
    return () => clearInterval(id)
  }, [reduce, paused, COUNT, AUTOPLAY_MS])

  const go = (dir) => setSlide((s) => (s + dir + COUNT) % COUNT)
  const goTo = (i) => setSlide(i)

  return (
    <section
      className="relative overflow-hidden bg-canvas"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {/* Full-bleed photo backdrop — crossfades automatically */}
      <div className="absolute inset-0" aria-hidden>
        <AnimatePresence initial={false}>
          <motion.div
            key={slide}
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: ready[slide] ? 1 : 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8, ease: 'easeInOut' }}
          >
            <motion.img
              ref={imgRef}
              src={HERO_IMAGES[slide]}
              alt=""
              onLoad={() => markReady(slide)}
              onError={() => markReady(slide)}
              className="h-full w-full object-cover"
              initial={false}
              animate={reduce ? undefined : { scale: [1, 1.07] }}
              // Zoom completes exactly as the next slide begins — the drift never looks cut short.
              transition={{ duration: AUTOPLAY_MS / 1000, ease: 'easeInOut' }}
              loading="eager"
              fetchPriority={slide === 0 ? 'high' : undefined}
              draggable={false}
            />
            <div
              className="pointer-events-none absolute inset-0 opacity-[0.045] mix-blend-overlay"
              style={{ backgroundImage: FILM_GRAIN }}
            />
          </motion.div>
        </AnimatePresence>

        {/* Left-to-right fade — keeps the copy readable, photo shows on the right.
            Mobile lightens to ~80% photo visibility so the image actually reads on phones. */}
        <div className="absolute inset-0 bg-gradient-to-r from-canvas via-canvas/40 to-canvas/15 sm:via-canvas/60 sm:to-transparent" />
        {/* Bottom fade into the page */}
        <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-canvas to-transparent" />
      </div>

      {/* Copy — centered vertically so the photo has premium presence on desktop */}
      <div className="relative mx-auto flex min-h-[30rem] max-w-7xl items-center px-4 pb-24 pt-16 sm:min-h-[34rem] sm:pt-20 lg:min-h-[40rem] lg:px-6 lg:pb-28 lg:pt-24">
        <div className="relative isolate max-w-xl">
          {/* Soft brand glow drifting behind the copy (CSS drift — respects reduced motion) */}
          <div
            aria-hidden
            className="pointer-events-none absolute -inset-24 -z-10 rounded-full bg-brand/15 blur-[110px] will-change-transform motion-safe:animate-[glow-drift_16s_ease-in-out_infinite] dark:bg-brand/25"
          />
          {/* Localised canvas haze — lifts text contrast over the photo, no visible edge */}
          <div
            aria-hidden
            className="pointer-events-none absolute -inset-8 -z-10 rounded-3xl bg-canvas/35 blur-2xl dark:bg-canvas/55"
          />
          <span className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-line bg-surface px-3 py-1.5 text-chips font-semibold text-brand shadow-xs sm:text-xs">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full motion-safe:animate-ping rounded-full bg-brand opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-brand" />
            </span>
            Coop Seasonal Sales, owned by members
          </span>

          <h1 className="mt-5 text-[1.625rem] font-bold leading-[1.15] tracking-tight text-fg sm:text-4xl lg:text-5xl">
            Quality <RotatingHeroWord />
            <br />
            Affordable Prices
            <br />
            <span className="text-brand">For Our Members</span>
          </h1>

          <p className="mt-5 max-w-md text-sm leading-6 text-fg/80 sm:text-base">
            CBN Coop brings Food distribution, Ram sales and Coop Exhibition to every branch. Order
            online, pick up at your branch, with fair prices, just for you.
          </p>

          <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              href="/portal"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-brand px-5 text-sm font-medium text-on-accent shadow-xs transition-colors duration-200 hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            >
              Get Started
              <ArrowRight className="h-4 w-4" />
            </Link>
            <a
              href={SIGNUP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-accent px-5 text-sm font-medium text-accent-fg shadow-xs transition-colors duration-200 hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            >
              Become a Member
              <ArrowUpRight className="h-4 w-4" />
            </a>
          </div>

          <ul className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted">
            {['Verified members only', '37 branches', 'Order online and pick up in person'].map((t) => (
              <li key={t} className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-success-fg" />
                {t}
              </li>
            ))}
          </ul>

        </div>
      </div>

      {/* Controls — dots + arrows, centred at the base of the stage */}
      <div className="absolute bottom-7 left-1/2 flex -translate-x-1/2 items-center gap-4">
        <div className="flex items-center gap-1.5">
          {HERO_IMAGES.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => goTo(i)}
              aria-label={`Show photo ${i + 1} of ${COUNT}`}
              aria-current={slide === i ? 'true' : undefined}
              className={`flex h-1.5 items-center justify-center rounded-full transition-all duration-300 ease-sakani focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${
                slide === i ? `${paused ? 'w-5' : 'w-4'} bg-brand` : 'w-1.5 bg-line-strong hover:bg-muted'
              }`}
            >
              {/* Subtle pause glyph — appears while the stage is hovered/focused (autoplay paused) */}
              {slide === i && (
                <span
                  aria-hidden
                  className={`flex items-center justify-center gap-[2px] transition-all duration-200 ease-sakani ${
                    paused ? 'scale-100 opacity-100' : 'scale-75 opacity-0'
                  }`}
                >
                  <span className="h-[3px] w-[1.5px] rounded-full bg-on-accent" />
                  <span className="h-[3px] w-[1.5px] rounded-full bg-on-accent" />
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => go(-1)}
            aria-label="Previous photo"
            className="flex h-7 w-7 items-center justify-center rounded-full border border-line bg-surface/80 text-subtext backdrop-blur-sm transition-colors duration-150 hover:bg-subtle hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => go(1)}
            aria-label="Next photo"
            className="flex h-7 w-7 items-center justify-center rounded-full border border-line bg-surface/80 text-subtext backdrop-blur-sm transition-colors duration-150 hover:bg-subtle hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

    </section>
  )
}

/* ---------------------------------------------------------------- */
/*  Landing page                                                      */
/* ---------------------------------------------------------------- */
export default function LandingPage() {
  const stats = [
    { value: '2,400+', label: 'Verified members', icon: Users },
    { value: '37', label: 'Branches nationwide', icon: MapPin },
    { value: '18,000+', label: 'Orders delivered', icon: Truck },
    { value: '4.8★', label: 'Average member rating', icon: Star },
  ]

  const services = [
    {
      icon: ShoppingBasket,
      tint: 'bg-brand-subtle text-brand-fg',
      title: 'Food Distribution',
      body: 'Seasonal food distribution with branch-marked prices, shop online, get it delivered to your branch.',
    },
    {
      icon: Beef,
      tint: 'bg-accent-subtle text-accent',
      title: 'Ram Sales',
      body: 'Purchase quality rams from our trusted nationwide vendors, at affordable prices',
    },
    {
      icon: Store,
      tint: 'bg-success-bg text-success-fg',
      title: 'Coop Exhibition',
      body: 'Explore diverse vendor stands and shop quality goods from our trusted partners.',
    },
    {
      icon: Truck,
      tint: 'bg-info-bg text-info-fg',
      title: 'Payment & Delivery',
      body: 'Order online and collect at your branch, using the cash, savings, or loan payment options.',
    },
  ]

  const steps = [
    {
      icon: BadgeCheck,
      title: 'Verify your membership',
      body: 'Log in with your member ID at the portal. Your branch, department and history come with you.',
    },
    {
      icon: ShoppingBasket,
      title: 'Shop the cycle',
      body: "Browse this cycle's items at your branch's prices while the shop is open.",
    },
    {
      icon: HandCoins,
      title: 'Order & pay your way',
      body: 'Check out in seconds. Pay on delivery, or use a member food loan with clear interest.',
    },
    {
      icon: Truck,
      title: 'Pick up or receive',
      body: 'Collect at your branch, or your rep delivers. Track it from posted to delivered.',
    },
  ]

  const benefits = [
    'Flexible Payment Options: Pay your way with cash, savings, or member food loans with clear interest. Convenience designed for you.',
    'Trusted & Reliable Vendors: Shop confidently from vetted vendors nationwide, with guaranteed quality and consistency.',
    'Affordable Prices for Quality Products: Enjoy fair, branch-marked prices on seasonal food and Ram sales, ensuring value without compromise.',
    'Community You Can Count On: Your branch representative knows you and your needs. No call centres, just people you trust.',
  ]

  const testimonials = [
    {
      quote:
        'I order on Sunday night and pick up on Tuesday. Same prices the branch agreed on. No surprises at all.',
      name: 'Amaka O.',
      branch: 'Lagos Branch',
      rating: 4.8,
    },
    {
      quote:
        "The Ram portal changed everything for us. Ordering early gave peace of mind, and the quality was unmatched, the best in the market. It's proof that the Coop delivers real value to its members.",
      name: 'Tunde A.',
      branch: 'Akure Branch',
      rating: 5.0,
    },
    {
      quote:
        'The loan payment option means I never miss a cycle, even when cash is tight. With flexible payments and trusted vendors, CBN Coop truly works like a cooperative: affordable, reliable, and built for members.',
      name: 'Blessing E.',
      branch: 'Asaba Branch',
      rating: 4.9,
    },
  ]

  const faqs = [
    {
      q: 'How do I start shopping?',
      a: "Verify your membership with your member ID at the Member Portal. Once verified, you can shop whenever your branch's food cycle is open.",
    },
    {
      q: 'How do payments and food loans work?',
      a: 'Order at checkout and pay on delivery. Qualifying members can also take a small-interest food loan against an order. The rate for the current cycle is shown before you confirm.',
    },
    {
      q: 'How does Ram distribution work?',
      a: 'Ram season runs on its own cycle through a separate member portal. Members order early, pay on delivery, and pick up through vendor-backed logistics.',
    },
    {
      q: 'Can I change or cancel an order?',
      a: 'Yes, while your order is still pending, contact your branch rep to adjust quantities or cancel. Once it is posted for delivery, changes are limited.',
    },
    {
      q: 'How do I reach support?',
      a: 'Email customerservice@cbncoopng.com or call 09096797982 / 08180578550. Your branch rep is the fastest route for order issues.',
    },
  ]

  return (
    <div className="scroll-smooth bg-canvas text-fg">
      {/* ============================ HEADER ============================ */}
      <LandingHeader />

      {/* ============================== HERO ============================== */}
      <PhotoHero />

      {/* ============================ STATS STRIP ============================ */}
      <section id="stats" className="relative scroll-mt-20 border-t border-line bg-canvas">
        <div className="mx-auto max-w-7xl px-4 py-10 lg:px-6 lg:py-14">
          <Reveal delay={0.1}>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
              {stats.map((s) => (
                <div
                  key={s.label}
                  className="flex flex-col rounded-xl border border-line bg-surface p-4 shadow-xs sm:p-5"
                >
                  <s.icon className="h-4 w-4 text-brand" strokeWidth={2} />
                  <dt className="order-2 mt-1 text-sm font-semibold leading-5 text-fg">{s.label}</dt>
                  <dd className="order-1 mt-2 text-xl font-bold tracking-tight text-brand sm:text-2xl">
                    {s.value}
                  </dd>
                </div>
              ))}
            </dl>
          </Reveal>
        </div>
      </section>

      {/* ============================ SERVICES ============================ */}
      <section id="services" className="scroll-mt-20 border-t border-line bg-subtle/40">
        <div className="mx-auto max-w-7xl px-4 py-16 lg:px-6 lg:py-24">
          <SectionHeading
            kicker="What we do"
            title="Coop Seasonal Sales at your fingertips"
            description="From Food distribution to Ram sales, one membership, four benefits, the Coop works for you."
          />
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {services.map((s, i) => (
              <Reveal key={s.title} delay={i * 0.07}>
                <div className="group h-full rounded-xl border border-line bg-surface p-5 shadow-xs transition-[border-color,box-shadow] duration-200 hover:border-line-strong hover:shadow-md">
                  <span
                    className={`flex h-10 w-10 items-center justify-center rounded-lg ${s.tint} transition-transform duration-200 group-hover:scale-105`}
                  >
                    <s.icon className="h-5 w-5" strokeWidth={2} />
                  </span>
                  <h3 className="mt-4 text-sm font-semibold text-fg">{s.title}</h3>
                  <p className="mt-1.5 text-sm leading-5 text-fg/80">{s.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* =========================== HOW IT WORKS =========================== */}
      <section id="how" className="scroll-mt-20">
        <div className="mx-auto max-w-7xl px-4 py-16 lg:px-6 lg:py-24">
          <SectionHeading
            kicker="How it works"
            title="From member ID to delivery in four steps"
          />
          <ol className="mx-auto mt-10 grid max-w-5xl gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((s, i) => (
              <Reveal key={s.title} delay={i * 0.07}>
                <li className="relative h-full rounded-xl border border-line bg-surface p-5 shadow-xs">
                  <span className="absolute -top-3 left-5 flex h-6 w-6 items-center justify-center rounded-full bg-brand text-[11px] font-bold text-on-accent shadow-xs">
                    {i + 1}
                  </span>
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-subtle text-brand-fg">
                    <s.icon className="h-5 w-5" strokeWidth={2} />
                  </span>
                  <h3 className="mt-4 text-sm font-semibold text-fg">{s.title}</h3>
                  <p className="mt-1.5 text-sm leading-5 text-fg/80">{s.body}</p>
                </li>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>

      {/* ============================= BENEFITS ============================= */}
      <section id="why" className="scroll-mt-20 border-t border-line bg-subtle/40">
        <div className="mx-auto max-w-7xl px-4 py-16 lg:px-6 lg:py-24">
          <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
            <Reveal>
              <div>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold uppercase tracking-wider text-brand">
                  Why join
                </span>
                <h2 className="mt-4 text-h1 font-bold tracking-tight text-fg">
                  Members don&apos;t just buy here. They own it.
                </h2>
                <p className="mt-3 max-w-lg text-sm leading-6 text-fg/80 sm:text-base">
                  Every order feeds a savings cycle that comes back to you. That is the difference
                  between shopping at a Coop and shopping anywhere else.
                </p>
                <ul className="mt-6 space-y-3">
                  {benefits.map((b) => (
                    <li key={b} className="flex items-start gap-2.5 text-sm leading-5 text-fg">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success-fg" />
                      {b}
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>

            <Reveal delay={0.1}>
              <div className="overflow-hidden rounded-2xl border border-accent/30 bg-accent-subtle shadow-lg">
                <div className="p-6 sm:p-8">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-accent-fg shadow-xs">
                    <PiggyBank className="h-5.5 w-5.5" strokeWidth={2} />
                  </span>
                  <h3 className="mt-5 text-h3 font-bold tracking-tight text-fg">The Member Advantage</h3>
                  <p className="mt-2 text-sm leading-6 text-fg/80">
                    Affordable branch pricing, flexible payment options, trusted vendors nationwide.
                    Joining the Coop means more than shopping. It means ownership, savings, and trust.
                  </p>
                  <div className="mt-5 flex items-center gap-2 text-xs font-medium text-accent">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Transparent cycle rates, published in advance
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* =========================== TESTIMONIALS =========================== */}
      <section>
        <div className="mx-auto max-w-7xl px-4 py-16 lg:px-6 lg:py-24">
          <SectionHeading
            kicker="Member stories"
            title="What members say about their Coop"
          />
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {testimonials.map((t, i) => (
              <Reveal key={t.name} delay={i * 0.07}>
                <figure className="flex h-full flex-col rounded-xl border border-line bg-surface p-5 shadow-xs">
                  <Quote className="h-5 w-5 text-brand/40" />
                  <blockquote className="mt-3 flex-1 text-sm leading-6 text-fg">
                    &ldquo;{t.quote}&rdquo;
                  </blockquote>
                  <figcaption className="mt-4 flex items-center gap-2.5 border-t border-line pt-4">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-subtle text-xs font-bold text-brand-fg">
                      {t.name.charAt(0)}
                    </span>
                    <div className="leading-tight">
                      <p className="text-xs font-semibold text-fg">{t.name}</p>
                      <p className="text-[11px] text-muted">{t.branch}</p>
                    </div>
                    <span className="ml-auto flex items-center gap-0.5 text-[11px] font-medium text-accent">
                      <Star className="h-3 w-3 fill-accent text-accent" /> {t.rating.toFixed(1)}
                    </span>
                  </figcaption>
                </figure>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ================================ FAQ ================================ */}
      <section id="faq" className="scroll-mt-20 border-t border-line bg-subtle/40">
        <div className="mx-auto max-w-3xl px-4 py-16 lg:px-6 lg:py-24">
          <SectionHeading
            kicker="Common questions"
            title="Everything you might ask first"
            description="Can&apos;t find it here? Your branch rep, or support, is one message away."
          />
          <div className="mt-10 space-y-3">
            {faqs.map((f, i) => (
              <Reveal key={f.q} delay={i * 0.05}>
                <details className="group rounded-xl border border-line bg-surface shadow-xs open:shadow-md">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-5 py-4 text-sm font-medium text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 [&::-webkit-details-marker]:hidden">
                    {f.q}
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted transition-transform duration-200 group-open:rotate-180" />
                  </summary>
                  <p className="px-5 pb-4 text-sm leading-6 text-fg/80">{f.a}</p>
                </details>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ============================ FINAL CTA ============================ */}
      <section className="bg-canvas">
        <div className="mx-auto max-w-7xl px-4 py-16 lg:px-6 lg:py-24">
          <Reveal>
            <div className="relative overflow-hidden rounded-2xl border border-brand-800 bg-gradient-to-br from-brand-900 via-brand-800 to-brand-700 px-6 py-12 text-center shadow-xl sm:px-12 sm:py-16">
              <div
                className="pointer-events-none absolute inset-0 opacity-20"
                style={{
                  backgroundImage:
                    'radial-gradient(circle at 20% 20%, rgba(255,255,255,0.35), transparent 40%), radial-gradient(circle at 80% 80%, rgba(255,255,255,0.25), transparent 40%)',
                }}
                aria-hidden
              />
              <div className="relative">
                <h2 className="mx-auto max-w-2xl text-h1 font-bold tracking-tight text-white">
                  Ready to shop the next cycle?
                </h2>
                <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-white/80 sm:text-base">
                  Log in with your member ID, or join the Coop and start building savings the moment
                  your membership is approved.
                </p>
                <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                  <Link
                    href="/portal"
                    className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-white px-6 text-sm font-semibold text-brand-900 shadow-lg transition-colors duration-200 hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 sm:w-auto"
                  >
                    Get Started
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                  <a
                    href={SIGNUP_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-white/40 bg-white/10 px-6 text-sm font-semibold text-white transition-colors duration-200 hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 sm:w-auto"
                  >
                    Become a Member
                    <ArrowUpRight className="h-4 w-4" />
                  </a>
                </div>
                <p className="mt-6 text-xs text-white/70">
                  Need help?{' '}
                  <span className="font-medium text-white/90">
                    customerservice@cbncoopng.com, 09096797982, 08180578550
                  </span>
                </p>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ============================== FOOTER ============================== */}
      <footer className="border-t border-line bg-surface">
        <div className="mx-auto max-w-7xl px-4 py-12 lg:px-6">
          <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
            <div className="sm:col-span-2 lg:col-span-1">
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg border border-line bg-surface">
                  <img src="/logo.png" alt="CBN Coop logo" className="h-7 w-7 object-contain" />
                </span>
                <div className="leading-tight">
                  <p className="text-sm font-bold text-fg">CBN Coop</p>
                  <p className="text-[11px] text-muted">Seasonal Sales</p>
                </div>
              </div>
              <p className="mt-4 max-w-xs text-sm leading-5 text-muted">
                CBN Coop brings Food distribution, Ram sales and Coop Exhibition to every branch.
                Order online, pick up at your branch, with fair prices, just for you.
              </p>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">Explore</p>
              <ul className="mt-4 space-y-2.5 text-sm">
                <li>
                  <Link
                    href="/portal"
                    className="rounded text-fg transition-colors duration-150 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                  >
                    Member Portal
                  </Link>
                </li>
                <li>
                  <Link
                    href="/contact"
                    className="rounded text-fg transition-colors duration-150 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                  >
                    Contact Us
                  </Link>
                </li>
                <li>
                  <Link
                    href="/vendor"
                    className="rounded text-fg transition-colors duration-150 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                  >
                    Vendor Portal
                  </Link>
                </li>
                <li>
                  <a
                    href={SIGNUP_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded text-fg transition-colors duration-150 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                  >
                    Become a Member
                  </a>
                </li>
              </ul>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">Support</p>
              <ul className="mt-4 space-y-2.5 text-sm text-fg">
                <li>
                  <a
                    href="mailto:customerservice@cbncoopng.com"
                    className="flex items-center gap-2 rounded text-fg transition-colors duration-150 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                  >
                    <Mail className="h-3.5 w-3.5 text-brand" />
                    customerservice@cbncoopng.com
                  </a>
                </li>
                <li>
                  <a
                    href="tel:09096797982"
                    className="flex items-center gap-2 rounded text-fg transition-colors duration-150 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                  >
                    <Phone className="h-3.5 w-3.5 text-brand" />
                    09096797982
                  </a>
                </li>
                <li>
                  <a
                    href="tel:08180578550"
                    className="flex items-center gap-2 rounded text-fg transition-colors duration-150 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                  >
                    <Phone className="h-3.5 w-3.5 text-brand" />
                    08180578550
                  </a>
                </li>
                <li className="flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5 text-brand" />
                  Mon to Fri, 8:00 AM to 4:00 PM
                </li>
              </ul>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">Branches</p>
              <p className="mt-4 flex items-start gap-2 text-sm leading-5 text-fg">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" />
                Serving members across 37 branches nationwide, including Abuja, Lagos and more.
              </p>
            </div>
          </div>

          <div className="mt-10 flex flex-col items-center gap-3 border-t border-line pt-6 sm:flex-row sm:justify-between">
            <p className="text-xs text-muted">© 2026 CBN Coop Seasonal Sales. All rights reserved.</p>
            <p className="flex items-center gap-1.5 text-xs text-muted">
              Powered by
              <Link
                href="/contact"
                className="rounded font-semibold text-brand transition-colors duration-150 hover:text-brand-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                MitemsHub
              </Link>
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}
