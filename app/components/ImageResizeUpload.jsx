'use client'

import { useState } from 'react'
import { ImagePlus, Loader2, Sparkles, X } from 'lucide-react'

// Standard processed size — uniform 1:1 product images (Jumia-style cards).
const CANVAS = 900
const WEBP_QUALITY = 0.82

// Cover-crop to a square, resize to CANVAS, export as WebP. Runs entirely in
// the browser so uploads are small and every product image is uniform.
async function processImage(file) {
  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  canvas.width = CANVAS
  canvas.height = CANVAS
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  const side = Math.min(bitmap.width, bitmap.height)
  const sx = (bitmap.width - side) / 2
  const sy = (bitmap.height - side) / 2
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, CANVAS, CANVAS)
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, CANVAS, CANVAS)
  bitmap.close?.()

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', WEBP_QUALITY))
  if (!blob) throw new Error('Could not process this image')
  return { blob, kb: Math.round(blob.size / 1024) }
}

export default function ImageResizeUpload({ onImageUploaded, currentImageUrl = null, itemSku = '' }) {
  const [uploading, setUploading] = useState(false)
  const [previewUrl, setPreviewUrl] = useState(currentImageUrl)
  const [dragOver, setDragOver] = useState(false)
  const [processed, setProcessed] = useState(null) // { kb }

  const handleFile = async (file) => {
    if (!file) return
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
    if (!validTypes.includes(file.type)) {
      alert('Please select a JPG, PNG or WebP image')
      return
    }
    if (file.size > 8 * 1024 * 1024) {
      alert('Please choose an image under 8MB')
      return
    }

    setUploading(true)
    setProcessed(null)
    try {
      const { blob, kb } = await processImage(file)
      const formData = new FormData()
      formData.append('image', blob, `${itemSku || 'product'}.webp`)
      formData.append('sku', itemSku)

      const res = await fetch('/api/vendor/exhibition/upload-image', { method: 'POST', body: formData })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || 'Upload failed')

      setProcessed({ kb })
      setPreviewUrl(json.imageUrl)
      onImageUploaded(json.imageUrl)
    } catch (e) {
      console.error('Image upload error:', e)
      alert(e.message || 'Upload failed. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  const onChange = (e) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    e.target.value = ''
  }

  const onDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  return (
    <div className="space-y-3">
      {previewUrl && (
        <div className="flex items-start gap-3">
          <div className="relative">
            <img
              src={previewUrl}
              alt="Product preview"
              className="h-24 w-24 rounded-xl border border-line-subtle object-cover"
            />
            <button
              type="button"
              onClick={() => {
                setPreviewUrl(null)
                onImageUploaded(null)
              }}
              aria-label="Remove image"
              className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-danger-fg text-on-accent shadow-sm transition-transform hover:scale-110"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {processed && (
            <p className="pt-1 text-chips text-muted">
              Optimized: 900×900 WebP · <span className="font-medium text-success-fg">{processed.kb} KB</span>
            </p>
          )}
        </div>
      )}

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
            <label htmlFor="exh-image-upload" className="mt-2 cursor-pointer text-sm">
              <span className="font-medium text-brand">Click to upload</span>
              <span className="text-muted"> or drag &amp; drop</span>
            </label>
            <input id="exh-image-upload" type="file" accept="image/jpeg,image/jpg,image/png,image/webp" className="hidden" onChange={onChange} />
            <p className="mt-2 flex items-center gap-1 text-chips text-muted">
              <Sparkles className="h-3 w-3 text-accent" />
              Auto-cropped square, resized &amp; compressed to WebP
            </p>
          </>
        )}
      </div>
    </div>
  )
}
