// Multiple photos per exhibition product. The first photo is the cover: it is
// mirrored into image_url so every screen that predates the gallery (cart,
// orders, invoices) still shows a picture.
export const MAX_PRODUCT_IMAGES = 6

// The ordered, de-duplicated photo list for a product row. Tolerates rows from
// before image_urls existed (only image_url set).
export function productImages(product) {
  const list = Array.isArray(product?.image_urls) ? product.image_urls : []
  const out = []
  for (const raw of [...list, product?.image_url]) {
    const url = String(raw || '').trim()
    if (url && !out.includes(url)) out.push(url)
  }
  return out
}

// Validates a photo list coming from a client before it is written to the
// database: strings only, no blanks, no duplicates, capped.
export function cleanProductImages(value) {
  const out = []
  for (const raw of Array.isArray(value) ? value : []) {
    const url = String(raw || '').trim()
    if (!url || out.includes(url)) continue
    out.push(url)
    if (out.length >= MAX_PRODUCT_IMAGES) break
  }
  return out
}
