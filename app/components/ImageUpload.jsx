'use client'

import { useState } from 'react'

export default function ImageUpload({ onImageUploaded, currentImageUrl = null, itemSku = '' }) {
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [previewUrl, setPreviewUrl] = useState(currentImageUrl)

  const handleFileSelect = async (file) => {
    if (!file) return

    // Validate file type
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
    if (!validTypes.includes(file.type)) {
      alert('Please select a valid image file (JPG, PNG, or WebP)')
      return
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      alert('File size must be less than 5MB')
      return
    }

    setUploading(true)

    try {
      const formData = new FormData()
      formData.append('image', file)
      formData.append('sku', itemSku)

      const response = await fetch('/api/upload-item-image', {
        method: 'POST',
        body: formData,
      })

      const result = await response.json()

      if (response.ok) {
        setPreviewUrl(result.imageUrl)
        onImageUploaded(result.imageUrl)
      } else {
        alert(result.error || 'Upload failed')
      }
    } catch (error) {
      console.error('Upload error:', error)
      alert('Upload failed. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  const handleFileChange = (e) => {
    const file = e.target.files[0]
    handleFileSelect(file)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    handleFileSelect(file)
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    setDragOver(true)
  }

  const handleDragLeave = (e) => {
    e.preventDefault()
    setDragOver(false)
  }

  return (
    <div className="space-y-4">
      {/* Image Preview */}
      {previewUrl && (
        <div className="flex justify-center">
          <div className="relative">
            <img
              src={previewUrl}
              alt="Item preview"
              className="w-32 h-32 object-cover rounded-lg border-2 border-line-subtle"
            />
            <button
              onClick={() => {
                setPreviewUrl(null)
                onImageUploaded(null)
              }}
              className="absolute -top-2 -right-2 w-6 h-6 bg-danger-fg text-on-accent rounded-full flex items-center justify-center text-xs hover:bg-red-600"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* Upload Area */}
      <div
        className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
          dragOver
            ? 'border-blue-400 bg-info-bg'
            : 'border-line hover:border-gray-400'
        }`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        {uploading ? (
          <div className="flex flex-col items-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-2"></div>
            <p className="text-sm text-muted">Uploading...</p>
          </div>
        ) : (
          <div>
            <svg
              className="mx-auto h-12 w-12 text-gray-400 mb-4"
              stroke="currentColor"
              fill="none"
              viewBox="0 0 48 48"
            >
              <path
                d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <div className="text-sm text-muted">
              <label htmlFor="image-upload" className="cursor-pointer">
                <span className="text-info-fg hover:text-blue-500 font-medium">
                  Click to upload
                </span>
                <span> or drag and drop</span>
              </label>
              <input
                id="image-upload"
                type="file"
                className="hidden"
                accept="image/jpeg,image/jpg,image/png,image/webp"
                onChange={handleFileChange}
                disabled={uploading}
              />
            </div>
            <p className="text-xs text-subtext mt-1">
              JPG, PNG, WebP up to 5MB
            </p>
          </div>
        )}
      </div>
    </div>
  )
}