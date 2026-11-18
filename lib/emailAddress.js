// lib/emailAddress.js
// One email shape check shared by the vendor import and admin vendor routes.
export function isValidEmail(value) {
  const email = String(value || '').trim()
  if (!email) return false
  if (email.length > 254) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase()
}
