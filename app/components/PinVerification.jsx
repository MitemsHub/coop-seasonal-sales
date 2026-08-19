// app/components/PinVerification.jsx
'use client'

import { useState } from 'react'

export default function PinVerification({ memberId, onPinVerified, onCancel }) {
  const [pin, setPin] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [attempts, setAttempts] = useState(0)

  const maxAttempts = 3

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!pin.trim() || isLoading || attempts >= maxAttempts) return

    setIsLoading(true)
    setError('')

    try {
      const response = await fetch('/api/members/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ member_id: memberId, pin: pin.trim().toUpperCase() })
      })

      const data = await response.json()

      if (response.ok && data.success) {
        onPinVerified()
      } else {
        const newAttempts = attempts + 1
        setAttempts(newAttempts)
        
        if (newAttempts >= maxAttempts) {
          setError('Too many failed attempts. Please try again later.')
        } else {
          setError(data.error || `Incorrect PIN. ${maxAttempts - newAttempts} attempts remaining.`)
        }
        setPin('')
      }
    } catch (error) {
      console.error('Error verifying PIN:', error)
      setError('Network error. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const isBlocked = attempts >= maxAttempts

  return (
    <div className="space-y-3 md:space-y-4">
      <div className="text-center mb-4">
        <h3 className="text-base sm:text-lg font-semibold text-fg mb-2">Enter Your PIN</h3>
        <p className="text-sm md:text-base text-muted">
          Welcome back! Please enter your PIN to continue
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3 md:space-y-4">
        {/* PIN Input */}
        <div className="relative">
          <input
            type="text"
            value={pin}
            onChange={(e) => setPin(e.target.value.toUpperCase())}
            disabled={isLoading || isBlocked}
            maxLength={5}
            className={`w-full py-2 pl-3 pr-9 md:py-3 md:pl-4 md:pr-10 border-2 rounded-xl focus:ring-2 focus:ring-brand/20 transition-all duration-200 outline-none text-sm md:text-base text-fg placeholder-gray-400 disabled:bg-subtle disabled:cursor-not-allowed ${
              !pin ? 'border-line focus:border-brand' :
              error ? 'border-danger focus:border-danger' :
              'border-info focus:border-info'
            }`}
            placeholder="Enter your PIN"
            autoFocus
          />
          <div className="absolute inset-y-0 right-0 flex items-center pr-2 md:pr-3">
            {!pin ? (
              <svg className="w-4 h-4 md:w-5 md:h-5 text-subtext" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            ) : error ? (
              <svg className="w-4 h-4 md:w-5 md:h-5 text-danger-fg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-4 h-4 md:w-5 md:h-5 text-info-fg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            )}
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="flex items-center text-danger-fg text-xs md:text-sm">
            <svg className="w-3 h-3 md:w-4 md:h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {error}
          </div>
        )}

        {/* Attempts Indicator */}
        {attempts > 0 && !isBlocked && (
          <div className="flex items-center text-warning-fg text-xs md:text-sm">
            <svg className="w-3 h-3 md:w-4 md:h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.464 0L4.35 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            {maxAttempts - attempts} attempts remaining
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex space-x-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="flex-1 px-4 py-2 md:px-6 md:py-3 text-fg text-sm md:text-base font-semibold rounded-xl border-2 border-line-strong hover:border-brand/50 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Use Member ID Only
          </button>
          <button
            type="submit"
            disabled={isLoading || !pin.trim() || isBlocked}
            className={`flex-1 inline-flex items-center justify-center px-4 py-2 md:px-6 md:py-3 text-sm md:text-base font-semibold rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl ${
              pin.trim() && !isLoading && !isBlocked
                ? 'bg-brand hover:bg-brand-hover text-on-accent'
                : 'bg-subtle text-muted cursor-not-allowed'
            }`}
          >
            {isLoading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 md:h-5 md:w-5 border-2 border-white border-t-transparent mr-2"></div>
                Verifying...
              </>
            ) : (
              <>
                <svg className="w-4 h-4 md:w-5 md:h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Verify PIN
              </>
            )}
          </button>
        </div>
      </form>

      {/* Help Text */}
      <div className="text-center">
        <p className="text-xs md:text-sm text-muted">
          Forgot your PIN? You can still access using Member ID only.
        </p>
      </div>
    </div>
  )
}