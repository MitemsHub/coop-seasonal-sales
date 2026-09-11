'use client'

// app/rep/error.js — Rep panel error boundary
import BrandError from '../components/ui/BrandError'

export default function RepError({ error, reset }) {
  return (
    <BrandError
      error={error}
      reset={reset}
      context="rep"
    />
  )
}
