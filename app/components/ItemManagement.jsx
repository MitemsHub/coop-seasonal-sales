'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import { supabase } from '@/lib/supabaseClient'
import ImageUpload from './ImageUpload'
import Button from './ui/Button'

export default function ItemManagement() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedItem, setSelectedItem] = useState(null)
  const [showImageUpload, setShowImageUpload] = useState(false)
  const [message, setMessage] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 8

  useEffect(() => {
    fetchItems()
  }, [])

  const fetchItems = async () => {
    try {
      const { data, error } = await supabase
        .from('items')
        .select('*')
        .order('name')

      if (error) throw error
      setItems(data || [])
    } catch (error) {
      console.error('Error fetching items:', error)
      setMessage({ type: 'error', text: 'Failed to load items' })
    } finally {
      setLoading(false)
    }
  }

  const withVersion = (url) => {
    if (!url) return url
    return url.includes('v=') ? url : (url.includes('?') ? `${url}&v=${Date.now()}` : `${url}?v=${Date.now()}`)
  }

  const updateItemImage = async (itemId, imageUrl) => {
    try {
      const versionedUrl = withVersion(imageUrl)
      const { error } = await supabase
        .from('items')
        .update({ image_url: versionedUrl })
        .eq('item_id', itemId)

      if (error) throw error

      // Refresh data from database to ensure consistency
      await fetchItems()
      
      // Force component refresh
      setRefreshKey(prev => prev + 1)

      setMessage({ type: 'success', text: 'Image updated successfully' })
      setShowImageUpload(false)
      setSelectedItem(null)
    } catch (error) {
      console.error('Error updating item image:', error)
      setMessage({ type: 'error', text: 'Failed to update image' })
    }
  }

  const handleImageUploaded = (imageUrl) => {
    if (selectedItem) {
      // Optimistically update local UI for instant feedback
      const versionedUrl = withVersion(imageUrl)
      setItems(prev => prev.map(it => (it.item_id === selectedItem.item_id ? { ...it, image_url: versionedUrl } : it)))
      setRefreshKey(prev => prev + 1)
      // Persist change to the database
      updateItemImage(selectedItem.item_id, versionedUrl)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand"></div>
      </div>
    )
  }

  // Pagination logic
  const totalPages = Math.ceil(items.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const endIndex = startIndex + itemsPerPage
  const currentItems = items.slice(startIndex, endIndex)

  const goToPage = (page) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)))
  }

  const getPageItems = (total, current) => {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
    const points = new Set([1, total, current - 1, current, current + 1])
    const nums = Array.from(points).filter(n => n >= 1 && n <= total).sort((a, b) => a - b)
    const out = []
    let prev = null
    for (const n of nums) {
      if (prev != null && n - prev > 1) out.push('…')
      out.push(n)
      prev = n
    }
    return out
  }

  const pageItems = getPageItems(totalPages, currentPage)

  return (
    <div className="space-y-6 w-full max-w-full overflow-x-hidden">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <h2 className="text-h2 font-semibold text-fg">Item Image Management</h2>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 min-w-0">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              fetchItems()
              setRefreshKey(prev => prev + 1)
              setMessage({ type: 'success', text: 'Data refreshed' })
            }}
          >
            Refresh
          </Button>
          <div className="text-xs sm:text-sm text-muted whitespace-normal break-words min-w-0">
            {items.length} items total • Page {currentPage} of {totalPages} • Showing {currentItems.length} items
          </div>
        </div>
      </div>

      {message && (
        <div className={`p-3 rounded-lg text-sm ${
          message.type === 'success' 
            ? 'bg-success-bg text-success-fg border border-success-border' 
            : 'bg-danger-bg text-danger-fg border border-danger-border'
        }`}>
          {message.text}
        </div>
      )}

      {/* Items Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
        {currentItems.map(item => (
          <div key={item.item_id} className="bg-surface border border-line-subtle rounded-lg p-3 hover:shadow-md transition-shadow overflow-hidden">
            {/* Item Image */}
            <div className="mb-3">
              <div className="relative w-full h-28 bg-muted rounded-lg overflow-hidden">
                {item.image_url ? (
                  <Image
                    key={refreshKey}
                    src={item.image_url}
                    alt={item.name}
                    fill
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, (max-width: 1280px) 25vw, (max-width: 1536px) 20vw, 16vw"
                    loading="lazy"
                    unoptimized
                    className="object-contain"
                  />
                ) : (
                  <Image
                    src="/images/items/placeholder.svg"
                    alt="No image"
                    fill
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, (max-width: 1280px) 25vw, (max-width: 1536px) 20vw, 16vw"
                    loading="lazy"
                    unoptimized
                    className="object-contain opacity-50"
                  />
                )}
              </div>
            </div>

            {/* Item Info */}
            <div className="space-y-2">
              <h3 className="font-medium text-fg text-sm leading-tight">
                {item.name}
              </h3>
              <div className="text-xs text-subtext">
                SKU: {item.sku}
              </div>
              <div className="text-xs text-subtext">
                {item.unit} • {item.category}
              </div>
              
              {/* Upload Button */}
              <Button
                variant="secondary"
                size="sm"
                className="w-full mt-2"
                onClick={() => {
                  setSelectedItem(item)
                  setShowImageUpload(true)
                }}
              >
                {item.image_url ? 'Change Image' : 'Add Image'}
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-center gap-2 mt-6">
          <button
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage === 1}
            className="px-3 py-2 bg-subtle hover:bg-muted border border-line-subtle text-fg disabled:bg-subtle disabled:border-transparent disabled:text-subtext rounded-lg transition-colors text-sm font-medium"
          >
            Previous
          </button>
          
          <div className="flex flex-wrap items-center justify-center gap-1">
            {pageItems.map((page, idx) =>
              page === '…' ? (
                <span key={`ellipsis-${idx}`} className="px-2 py-2 text-sm text-subtext select-none">
                  …
                </span>
              ) : (
                <button
                  key={page}
                  onClick={() => goToPage(page)}
                  aria-current={currentPage === page ? 'page' : undefined}
                  className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                    currentPage === page
                      ? 'bg-brand text-on-accent'
                      : 'bg-subtle hover:bg-muted border border-line-subtle text-fg'
                  }`}
                >
                  {page}
                </button>
              )
            )}
          </div>
          
          <button
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage === totalPages}
            className="px-3 py-2 bg-subtle hover:bg-muted border border-line-subtle text-fg disabled:bg-subtle disabled:border-transparent disabled:text-subtext rounded-lg transition-colors text-sm font-medium"
          >
            Next
          </button>
        </div>
      )}

      {items.length === 0 && (
        <div className="text-center py-8">
          <svg className="w-12 h-12 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
          </svg>
          <p className="text-subtext">No items found</p>
        </div>
      )}

      {/* Image Upload Modal */}
      {showImageUpload && selectedItem && (
        <div className="fixed inset-0 bg-transparent flex items-center justify-center p-4 z-50">
          <div className="bg-surface rounded-lg p-6 max-w-md w-full">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-[15px] font-semibold">
                Upload Image for {selectedItem.name}
              </h3>
              <button
                onClick={() => {
                  setShowImageUpload(false)
                  setSelectedItem(null)
                }}
                className="text-gray-400 hover:text-muted"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="mb-4">
              <div className="text-sm text-muted mb-2">
                SKU: {selectedItem.sku}
              </div>
            </div>

            <ImageUpload
              onImageUploaded={handleImageUploaded}
              currentImageUrl={selectedItem.image_url}
              itemSku={selectedItem.sku}
            />
          </div>
        </div>
      )}
    </div>
  )
}
