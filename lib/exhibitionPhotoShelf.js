// lib/exhibitionPhotoShelf.js
// Photo-based shelf *suggestion* for the product forms. This never feeds the
// shop's automatic classification: it only proposes a default shelf that a
// vendor or admin confirms before saving.
//
// Cost order, cheapest first:
//   1. the product name — if the shop's own reading already places it, stop;
//   2. the image filename — free, and often carries the word the name omits
//      ("sdd-bonestraight-wig.webp");
//   3. a vision model, only when both are silent, one image, one short reply.
import { SHELVES, suggestShelfKey } from './exhibitionShelf'

const LABEL_BY_KEY = new Map(SHELVES.map((shelf) => [shelf.key, shelf.label]))

// Filenames that are just upload noise carry no shelf words. Stripped before
// the vocabulary is asked, so "draft-mwqm10hu-jcuf" stays silent.
const NOISE = /\b(?:img|image|photo|picture|pic|draft|copy|final|new|upload|whatsapp|screenshot|img-\d+)\b/gi

export function shelfFromFileName(imageUrl = '') {
  const path = String(imageUrl || '').split('?')[0].split('#')[0]
  const file = path.split('/').pop() || ''
  if (!file) return null
  const words = decodeURIComponent(file)
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .replace(NOISE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  // A short product code ("V0099-TUR-003") must not vote: require a real word.
  if (!words.split(' ').some((word) => word.length >= 4)) return null
  const key = suggestShelfKey({ name: words })
  if (!key) return null
  return { key, label: LABEL_BY_KEY.get(key) || '', source: 'filename' }
}

// The model is asked to reply with one of the shop's labels. Anything else —
// "Unknown", prose, a partial sentence — is not a suggestion.
export function parseVisionShelf(reply) {
  const text = String(reply || '').trim().toLowerCase()
  if (!text || text.startsWith('unknown')) return null
  const exact = SHELVES.find((shelf) => shelf.label.toLowerCase() === text)
  if (exact) return { key: exact.key, label: exact.label }
  // Tolerate a short answer such as "hair wigs" or "hair & wigs."
  const cleaned = text.replace(/[.!]+$/, '')
  const match = SHELVES.find((shelf) => {
    const label = shelf.label.toLowerCase()
    return cleaned === label || cleaned === label.replace(/\s*&\s*/g, ' ')
  })
  return match ? { key: match.key, label: match.label } : null
}

const LABELS = SHELVES.filter((shelf) => shelf.key !== 'other')
  .map((shelf) => shelf.label)
  .join(' | ')

const PROMPT = `You classify a retail product photo for a Nigerian cooperative market stall.
Choose exactly one shelf from this list and reply with its label and nothing else:
${LABELS}
If the photo does not clearly show a product that belongs to one of them, reply: Unknown`

/**
 * Suggests a shelf from the listing's photo. Returns null when the listing does
 * not need one (the name already places it) or when nothing is confident.
 *
 * `fetchImpl` is injectable so the fallback chain can be tested without a
 * network call. The key is read from OPENAI_API_KEY; the endpoint defaults to
 * OpenAI and can be pointed at any OpenAI-compatible server.
 */
export async function suggestShelfFromPhoto({
  name = '',
  imageUrl = '',
  apiKey = '',
  baseUrl = 'https://api.openai.com/v1',
  model = 'gpt-4o-mini',
  fetchImpl = fetch,
  timeoutMs = 8000,
} = {}) {
  // The name already places it — the form's existing suggestion is enough.
  if (suggestShelfKey({ name })) return null

  const fromFile = shelfFromFileName(imageUrl)
  if (fromFile) return fromFile

  if (!imageUrl || !apiKey) return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchImpl(`${String(baseUrl).replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 20,
        messages: [
          { role: 'system', content: PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Which shelf is this product on?' },
              { type: 'image_url', image_url: { url: imageUrl } },
            ],
          },
        ],
      }),
    })
    if (!res.ok) return null
    const json = await res.json()
    const parsed = parseVisionShelf(json?.choices?.[0]?.message?.content)
    return parsed ? { ...parsed, source: 'vision' } : null
  } catch {
    // A slow or failed model must never block listing a product.
    return null
  } finally {
    clearTimeout(timer)
  }
}
