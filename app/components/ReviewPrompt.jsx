'use client'

import { useState } from 'react'
import { Star, X, Send, CheckCircle2 } from 'lucide-react'
import { Button } from './ui/Button'

/**
 * ReviewPrompt — shown after order success, lets members leave a review.
 *
 * Props:
 *   memberId   – the member's ID
 *   module     – 'food' | 'ram' | 'exhibition'
 *   orderId    – the order ID
 *   branchName – member's branch name
 *   memberName – member's display name
 */
export default function ReviewPrompt({ memberId, module, orderId, branchName, memberName }) {
  const [open, setOpen] = useState(true)
  const [rating, setRating] = useState(0)
  const [hovered, setHovered] = useState(0)
  const [reviewText, setReviewText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState(null)

  if (!open || submitted) return null

  const handleSubmit = async () => {
    if (rating === 0) {
      setError('Please select a star rating')
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      const res = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          member_id: memberId,
          module,
          order_id: orderId,
          rating,
          review_text: reviewText.trim(),
          reviewer_name: memberName || '',
          branch_name: branchName || '',
        }),
      })

      const json = await res.json()

      if (!json.ok) {
        setError(json.error || 'Failed to submit review')
        return
      }

      setSubmitted(true)
    } catch (e) {
      setError(e.message || 'Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mt-6 rounded-xl border border-line bg-surface p-5 shadow-xs">
      <div className="flex items-start justify-between">
        <h3 className="text-sm font-semibold text-fg">How was your experience?</h3>
        <button
          onClick={() => setOpen(false)}
          className="text-muted hover:text-fg transition-colors"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <p className="mt-1 text-xs text-muted">
        Your feedback helps us improve. Reviews are shared anonymously after moderation.
      </p>

      {/* Star rating */}
      <div className="mt-4 flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            onMouseEnter={() => setHovered(star)}
            onMouseLeave={() => setHovered(0)}
            onClick={() => setRating(star)}
            className="transition-transform hover:scale-110"
            aria-label={`${star} star${star > 1 ? 's' : ''}`}
          >
            <Star
              className={`h-6 w-6 transition-colors ${
                star <= (hovered || rating)
                  ? 'fill-amber-400 text-amber-400'
                  : 'text-line'
              }`}
            />
          </button>
        ))}
        {rating > 0 && (
          <span className="ml-2 text-xs text-muted">
            {rating === 1 && 'Poor'}
            {rating === 2 && 'Fair'}
            {rating === 3 && 'Good'}
            {rating === 4 && 'Very Good'}
            {rating === 5 && 'Excellent'}
          </span>
        )}
      </div>

      {/* Review text */}
      <textarea
        value={reviewText}
        onChange={(e) => setReviewText(e.target.value)}
        placeholder="Tell us more about your experience (optional)"
        rows={3}
        className="mt-3 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 resize-none"
      />

      {error && <p className="mt-2 text-xs text-danger">{error}</p>}

      <div className="mt-3 flex items-center gap-2">
        <Button
          onClick={handleSubmit}
          loading={submitting}
          size="sm"
        >
          <Send className="h-3.5 w-3.5 mr-1" />
          Submit Review
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setOpen(false)}
        >
          Skip
        </Button>
      </div>
    </div>
  )
}
