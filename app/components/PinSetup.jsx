// app/components/PinSetup.jsx
'use client'

import { useState } from 'react'

export default function PinSetup({ memberId, onPinSet, onCancel, onBack }) {
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const validatePin = (pinValue) => {
    if (!pinValue) return { isValid: false, message: '' }
    if (pinValue.length < 4) return { isValid: false, message: 'PIN must be at least 4 characters' }
    if (pinValue.length > 5) return { isValid: false, message: 'PIN must be 5 characters or less' }
    if (!/^[0-9]+$/.test(pinValue)) return { isValid: false, message: 'PIN must contain only numbers' }
    return { isValid: true, message: 'Valid PIN format' }
  }

  const pinValidation = validatePin(pin)
  const pinsMatch = pin && confirmPin && pin === confirmPin

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!pinValidation.isValid || !pinsMatch) return

    setIsLoading(true)
    setError('')

    try {
      const response = await fetch('/api/members/set-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId: memberId, pin })
      })

      const data = await response.json()

      if (response.ok && data.success) {
        // First-time set-pin issues the signed member session — pass the
        // claims through so the launcher can build the full user object.
        onPinSet(data.member)
      } else {
        setError(data.error || 'Failed to set PIN')
      }
    } catch (error) {
      console.error('Error setting PIN:', error)
      setError('Network error. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="space-y-3 md:space-y-4">
      <div className="text-center mb-4">
        <h3 className="text-base sm:text-lg font-semibold text-fg mb-2">Set Up Your PIN</h3>
        <p className="text-sm md:text-base text-muted">
          Create a 4-5 digit PIN for quick access next time
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3 md:space-y-4">
        {/* PIN Input */}
        <div className="relative">
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={pin}
            onChange={(e) => {
              const value = e.target.value.replace(/[^0-9]/g, '')
              setPin(value)
            }}
            disabled={isLoading}
            maxLength={5}
            className={`w-full py-2 pl-3 pr-9 md:py-3 md:pl-4 md:pr-10 border-2 rounded-xl focus:ring-2 focus:ring-brand/20 transition-all duration-200 outline-none text-sm md:text-base text-fg placeholder-gray-400 disabled:bg-subtle disabled:cursor-not-allowed ${
              !pin ? 'border-line focus:border-brand' :
              pinValidation.isValid ? 'border-success focus:border-success' :
              'border-danger focus:border-danger'
            }`}
            placeholder="Enter PIN (4-5 digits)"
          />
          <div className="absolute inset-y-0 right-0 flex items-center pr-2 md:pr-3">
            {!pin ? (
              <svg className="w-4 h-4 md:w-5 md:h-5 text-subtext" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            ) : pinValidation.isValid ? (
              <svg className="w-4 h-4 md:w-5 md:h-5 text-success-fg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-4 h-4 md:w-5 md:h-5 text-danger-fg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            )}
          </div>
        </div>

        {/* PIN Validation Feedback */}
        {pin && !pinValidation.isValid && (
          <div className="flex items-center text-danger-fg text-xs md:text-sm">
            <svg className="w-3 h-3 md:w-4 md:h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {pinValidation.message}
          </div>
        )}

        {/* Confirm PIN Input */}
        <div className="relative">
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={confirmPin}
            onChange={(e) => {
              const value = e.target.value.replace(/[^0-9]/g, '')
              setConfirmPin(value)
            }}
            disabled={isLoading || !pinValidation.isValid}
            maxLength={5}
            className={`w-full py-2 pl-3 pr-9 md:py-3 md:pl-4 md:pr-10 border-2 rounded-xl focus:ring-2 focus:ring-brand/20 transition-all duration-200 outline-none text-sm md:text-base text-fg placeholder-gray-400 disabled:bg-subtle disabled:cursor-not-allowed ${
              !confirmPin ? 'border-line focus:border-brand' :
              pinsMatch ? 'border-success focus:border-success' :
              'border-danger focus:border-danger'
            }`}
            placeholder="Confirm PIN"
          />
          <div className="absolute inset-y-0 right-0 flex items-center pr-2 md:pr-3">
            {!confirmPin ? (
              <svg className="w-4 h-4 md:w-5 md:h-5 text-subtext" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            ) : pinsMatch ? (
              <svg className="w-4 h-4 md:w-5 md:h-5 text-success-fg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-4 h-4 md:w-5 md:h-5 text-danger-fg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            )}
          </div>
        </div>

        {/* Confirm PIN Validation Feedback */}
        {confirmPin && !pinsMatch && (
          <div className="flex items-center text-danger-fg text-xs md:text-sm">
            <svg className="w-3 h-3 md:w-4 md:h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            PINs do not match
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="flex items-center text-danger-fg text-xs md:text-sm">
            <svg className="w-3 h-3 md:w-4 md:h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {error}
          </div>
        )}

        {/* Action Button */}
        <button
          type="submit"
          disabled={isLoading || !pinValidation.isValid || !pinsMatch}
          className={`w-full inline-flex items-center justify-center px-4 py-2 md:px-6 md:py-3 text-sm md:text-base font-semibold rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl ${
            pinValidation.isValid && pinsMatch && !isLoading
              ? 'bg-brand hover:bg-brand-hover text-on-accent'
              : 'bg-subtle text-muted cursor-not-allowed'
          }`}
        >
          {isLoading ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 md:h-5 md:w-5 border-2 border-white border-t-transparent mr-2"></div>
              Setting PIN...
            </>
          ) : (
            <>
              <svg className="w-4 h-4 md:w-5 md:h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Set PIN
            </>
          )}
        </button>
      </form>

      {/* Escape affordances — member can skip PIN setup or return to the ID step */}
      <div className="space-y-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          disabled={isLoading}
          className="w-full inline-flex items-center justify-center px-4 py-2 md:px-6 md:py-3 text-fg text-sm md:text-base font-semibold rounded-xl transition-all duration-200 border border-line-strong hover:bg-subtle disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Skip for now
        </button>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            disabled={isLoading}
            className="w-full inline-flex items-center justify-center gap-1.5 text-caption md:text-sm text-muted transition-colors duration-150 hover:text-fg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg className="h-3 w-3 md:h-4 md:w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to member ID
          </button>
        )}
      </div>
    </div>
  )
}