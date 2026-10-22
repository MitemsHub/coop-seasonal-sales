// public/sw.js — CBN Coop service worker.
//
// Conservative, member-friendly offline behaviour:
//   • Navigations try the network first (the app is live-data heavy:
//     prices, cycles, eligibility change constantly) and fall back to a
//     small cached offline page when the device is offline.
//   • Immutable build assets (/_next/static, icons, images) use
//     cache-first, so repeat visits load fast even on weak rural
//     connections members often have.
//   • Everything else — API calls, admin pages, uploads — goes straight
//     to the network: we never serve stale money/order data from cache.

const CACHE = 'cbn-coop-v1'
const OFFLINE_URL = '/offline.html'
const CACHE_FIRST = [
  '/_next/static/',
  '/icons/',
  '/images/',
  '/logo.png',
  '/landing/',
]
const BYPASS = ['/api/', '/admin/']
const PRECACHE = [OFFLINE_URL, '/icons/icon-192.png', '/icons/icon-512.png', '/logo.png?v=4']

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      await Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => {})))
    })()
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)))
      await self.clients.claim()
    })()
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (BYPASS.some((p) => url.pathname.startsWith(p))) return

  // Page navigations: network first, offline fallback cached at install.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request)
        } catch {
          const cache = await caches.open(CACHE)
          const offline = await cache.match(OFFLINE_URL)
          return offline || Response.error()
        }
      })()
    )
    return
  }

  // Immutable assets: cache first.
  if (CACHE_FIRST.some((p) => url.pathname.startsWith(p))) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE)
        const cached = await cache.match(request)
        if (cached) return cached
        try {
          const fresh = await fetch(request)
          if (fresh.ok || fresh.type === 'opaque') cache.put(request, fresh.clone())
          return fresh
        } catch {
          return cached || new Response('Offline and not in cache', { status: 504, statusText: 'Offline' })
        }
      })()
    )
  }
})
