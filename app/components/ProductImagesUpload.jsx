'use client'

// Vendor product photos. A product may carry several photos; the first is the
// cover the shop card shows, the rest appear in the card carousel and the view
// popup. Each photo is resized/compressed in the browser before it is uploaded.
import { useState } from 'react'
import { ImagePlus, Loader2, Sparkles, Star, X } from 'lucide-react'
import { isSupportedProductImage, optimizeProductImage } from '@/lib/optimizeImage'
import { MAX_PRODUCT_IMAGES } from '@/lib/exhibitionProductImages'

export default function ProductImagesUpload({ images = [], onChange, itemSku = '' }) {
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState('')

  const full = images.length >= MAX_PRODUCT_IMAGES

  const handleFiles = async (fileList) => {
    const picked = Array.from(fileList || [])
    if (!picked.length) return
    if (full) {
      setError(`You can add up to ${MAX_PRODUCT_IMAGES} photos.`)
      return
    }

    const bad = picked.find((file) => !isSupportedProductImage(file))
    if (bad) {
      setError('Please select a JPG, PNG, WebP, AVIF or HEIC image')
      return
    }

    setUploading(true)
    setError('')
    let next = [...images]
    try {
      for (const file of picked.slice(0, MAX_PRODUCT_IMAGES - next.length)) {
        const { blob } = await optimizeProductImage(file)
        const formData = new FormData()
        formData.append('image', blob, `${itemSku || 'product'}.webp`)
        formData.append('sku', itemSku)
        // Slot 1 keeps the long-standing deterministic path (replacing the
        // cover replaces that file); later slots get a unique path.
        formData.append('slot', String(next.length + 1))

        const res = await fetch('/api/vendor/exhibition/upload-image', { method: 'POST', body: formData })
        const json = await res.json().catch(() => null)
        if (!res.ok || !json?.success || !json?.imageUrl) {
          throw new Error(json?.error || 'Upload failed')
        }
        next = [...next, json.imageUrl]
        onChange(next)
      }
    } catch (e) {
      console.error('Image upload error:', e)
      setError(e.message || 'Upload failed. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  const onInput = (e) => {
    const files = e.target.files
    handleFiles(files)
    e.target.value = ''
  }

  const onDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    handleFiles(e.dataTransfer.files)
  }

  const removeAt = (index) => {
    setError('')
    onChange(images.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-3">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((src, i) => (
            <div key={`${src}-${i}`} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt={`Product photo ${i + 1}`}
                className="h-24 w-24 rounded-xl border border-line-subtle bg-subtle object-cover"
              />
              {i === 0 && (
                <span className="absolute left-1 top-1 inline-flex items-center gap-0.5 rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-semibold text-on-accent">
                  <Star className="h-2.5 w-2.5" strokeWidth={2.4} />
                  Cover
                </span>
              )}
              <button
                type="button"
                onClick={() => removeAt(i)}
                aria-label={`Remove photo ${i + 1}`}
                className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-danger-fg text-on-accent shadow-sm transition-transform hover:scale-110"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {!!error && (
        <p className="rounded-lg border border-danger-border bg-danger-bg px-2.5 py-1.5 text-chips text-danger-fg">{error}</p>
      )}

      {!full && (
        <div
          onDrop={onDrop}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors ${
            dragOver ? 'border-brand bg-brand/5' : 'border-line bg-subtle/50 hover:border-brand/50'
          }`}
        >
          {uploading ? (
            <div className="flex flex-col items-center gap-2 py-2">
              <Loader2 className="h-6 w-6 animate-spin text-brand" />
              <p className="text-sm text-muted">Optimizing & uploading…</p>
            </div>
          ) : (
            <>
              <ImagePlus className="h-7 w-7 text-muted" strokeWidth={1.75} />
              <label htmlFor="product-images-upload" className="mt-2 cursor-pointer text-sm">
                <span className="font-medium text-brand">{images.length ? 'Add another photo' : 'Click to upload'}</span>
                <span className="text-muted"> or drag &amp; drop</span>
              </label>
              <input
                id="product-images-upload"
                type="file"
                accept="image/jpeg,image/jpg,image/png,image/webp,image/avif,image/heic,image/heif,.heic,.heif"
                multiple
                className="hidden"
                onChange={onInput}
              />
              <p className="mt-2 flex items-center gap-1 text-chips text-muted">
                <Sparkles className="h-3 w-3 text-accent" />
                Add up to {MAX_PRODUCT_IMAGES} photos · first one is the cover · resized to WebP automatically
              </p>
            </>
          )}
        </div>
      )}

      {full && (
        <p className="text-chips text-muted">That is the maximum of {MAX_PRODUCT_IMAGES} photos. Remove one to add another.</p>
      )}
    </div>
  )
}
