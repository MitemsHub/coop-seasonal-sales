'use client'

// app/hooks/usePhotoShelfSuggestion.js
// Asks the server for a shelf suggestion from a listing's photo, for the vendor
// and admin product forms. It only ever pre-selects a shelf: the person saving
// the product confirms it, and the shop's own classification never sees it.
//
// The server does the cheap steps first (name, then filename), so this makes no
// network call for a listing whose name already places it.
import { useEffect, useRef, useState } from 'react'
import { suggestShelfKey } from '@/lib/exhibitionShelf'

export default function usePhotoShelfSuggestion({
  enabled = true,
  name = '',
  imageUrl = '',
  categories = [],
  categoryId = '',
  onSuggestion,
}) {
  const [suggestion, setSuggestion] = useState(null)
  const askedRef = useRef('')
  const categoriesRef = useRef(categories)
  const appliedRef = useRef('')
  const onSuggestionRef = useRef(onSuggestion)

  useEffect(() => {
    onSuggestionRef.current = onSuggestion
  }, [onSuggestion])

  useEffect(() => {
    categoriesRef.current = categories
  }, [categories])

  useEffect(() => {
    if (!enabled || !imageUrl) return undefined
    // The name already places it — the form is already suggesting that shelf.
    if (suggestShelfKey({ name })) return undefined
    const key = `${imageUrl}|${String(name).trim().toLowerCase()}`
    if (askedRef.current === key) return undefined
    askedRef.current = key

    let alive = true
    fetch('/api/exhibition/suggest-shelf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, imageUrl }),
      cache: 'no-store',
    })
      .then((res) => res.json())
      .then((json) => {
        if (alive && json?.suggestion?.key) setSuggestion(json.suggestion)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [enabled, imageUrl, name])

  // Apply once, and only while the person has not picked a shelf themselves.
  useEffect(() => {
    if (!suggestion || categoryId) return
    if (appliedRef.current === suggestion.key) return
    const match = categories.find(
      (c) => String(c.name || '').trim().toLowerCase() === suggestion.label.toLowerCase()
    )
    if (!match) return
    appliedRef.current = suggestion.key
    onSuggestionRef.current?.(suggestion, String(match.id))
  }, [suggestion, categoryId, categories])

  const reset = () => {
    askedRef.current = ''
    appliedRef.current = ''
    setSuggestion(null)
  }

  return { suggestion, reset }
}
