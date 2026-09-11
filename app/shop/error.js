'use client'

// app/shop/error.js — Shop error boundary
import BrandError from '../components/ui/BrandError'

export default function ShopError({ error, reset }) {
  return (
    <BrandError
      error={error}
      reset={reset}
      context="shop"
    />
  )
}
