'use client'

// app/error.js — Root error boundary
// Catches unhandled runtime errors on any page and shows a branded
// recovery UI instead of a blank screen.
import BrandError from './components/ui/BrandError'

export default function GlobalError({ error, reset }) {
  return (
    <BrandError
      error={error}
      reset={reset}
      context="root"
    />
  )
}
