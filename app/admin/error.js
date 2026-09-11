'use client'

// app/admin/error.js — Admin error boundary
// Catches runtime errors within the admin shell and shows a branded
// recovery UI that keeps the admin in the admin context.
import BrandError from '../components/ui/BrandError'

export default function AdminError({ error, reset }) {
  return (
    <BrandError
      error={error}
      reset={reset}
      context="admin"
    />
  )
}
