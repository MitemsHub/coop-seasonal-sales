'use client'

// app/vendor/error.js — Vendor portal error boundary
import BrandError from '../components/ui/BrandError'

export default function VendorError({ error, reset }) {
  return (
    <BrandError
      error={error}
      reset={reset}
      context="vendor"
    />
  )
}
