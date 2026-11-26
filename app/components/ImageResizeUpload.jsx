'use client'

import { useState } from 'react'
import { ImagePlus, Loader2, Sparkles, X } from 'lucide-react'
import { extensionForImageMime, isSupportedProductImage, optimizeProductImage, PRODUCT_IMAGE_MAX_SIZE } from '@/lib/optimizeImage'

export default function ImageResizeUpload({ onImageUploaded, currentImageUrl = null, itemSku = '' }) {
  const [uploading, setUploading] = useState(false)
  const [previewUrl, setPreviewUrl] = useState(currentImageUrl)
  const [dragOver, setDragOver] = useState(false)
  const [processed, setProcessed] = useState(null) // { kb }

  const handleFile = async (file) => {
    if (!file) return
    if (!isSupportedProductImage(file)) {
      alert('Please select a JPG, PNG, WebP, AVIF or HEIC image')
      return
    }

    setUploading(true)
    setProcessed(null)
    try {
      const { blob, mime, kb } = await optimizeProductImage(file)
      const formData = new FormData()
      formData.append('image', blob, `${itemSku || 'product'}.${extensionForImageMime(mime)}`)
      formData.append('sku', itemSku)

      const res = await fetch('/api/vendor/exhibition/upload-image', { method: 'POST', body: formData })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || 'Upload failed')

      setProcessed({ kb, mime })
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
              className="h-24 w-24 rounded-xl border border-line-subtle bg-subtle object-contain"
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
              Optimized: {processed.mime === 'image/jpeg' ? 'JPG' : 'WebP'}, up to {PRODUCT_IMAGE_MAX_SIZE}px · <span className="font-medium text-success-fg">{processed.kb} KB</span>
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
            <input
              id="exh-image-upload"
              type="file"
              accept="image/jpeg,image/jpg,image/png,image/webp,image/avif,image/heic,image/heif,.heic,.heif"
              className="hidden"
              onChange={onChange}
            />
            <p className="mt-2 flex items-center gap-1 text-chips text-muted">
              <Sparkles className="h-3 w-3 text-accent" />
              JPG, PNG, WebP, AVIF or HEIC · any size — resized &amp; compressed to WebP, the whole photo is kept
            </p>
          </>
        )}
      </div>
    </div>
  )
}
