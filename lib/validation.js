// lib/validation.js
// Input validation and sanitization utilities

/**
 * Sanitize string input to prevent XSS and injection attacks
 * @param {string} input - The input string to sanitize
 * @param {object} options - Sanitization options
 * @returns {string} - Sanitized string
 */
export function sanitizeString(input, options = {}) {
  if (typeof input !== 'string') {
    return ''
  }
  
  let sanitized = input.trim()
  
  // Remove null bytes
  sanitized = sanitized.replace(/\0/g, '')
  
  // Basic HTML entity encoding for XSS prevention
  if (options.encodeHtml !== false) {
    sanitized = sanitized
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;')
  }
  
  // Limit length
  const maxLength = options.maxLength || 1000
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength)
  }
  
  return sanitized
}

/**
 * Validate and sanitize member ID
 * @param {string} memberId - Member ID to validate
 * @returns {object} - {isValid: boolean, sanitized: string, error?: string}
 */
export function validateMemberId(memberId) {
  if (!memberId || typeof memberId !== 'string') {
    return { isValid: false, sanitized: '', error: 'Member ID is required' }
  }
  
  const sanitized = sanitizeString(memberId, { maxLength: 50 })
  
  // Allow alphanumeric and basic special characters
  if (!/^[A-Za-z0-9_-]+$/.test(sanitized)) {
    return { isValid: false, sanitized, error: 'Member ID contains invalid characters' }
  }
  
  if (sanitized.length < 1 || sanitized.length > 50) {
    return { isValid: false, sanitized, error: 'Member ID must be 1-50 characters' }
  }
  
  return { isValid: true, sanitized }
}

/**
 * Validate and sanitize SKU
 * @param {string} sku - SKU to validate
 * @returns {object} - {isValid: boolean, sanitized: string, error?: string}
 */
export function validateSku(sku) {
  if (!sku || typeof sku !== 'string') {
    return { isValid: false, sanitized: '', error: 'SKU is required' }
  }
  
  const sanitized = sanitizeString(sku, { maxLength: 100 }).toUpperCase()
  
  // Allow alphanumeric and basic special characters
  if (!/^[A-Z0-9_-]+$/.test(sanitized)) {
    return { isValid: false, sanitized, error: 'SKU contains invalid characters' }
  }
  
  if (sanitized.length < 1 || sanitized.length > 100) {
    return { isValid: false, sanitized, error: 'SKU must be 1-100 characters' }
  }
  
  return { isValid: true, sanitized }
}

/**
 * Validate and sanitize branch code
 * @param {string} branchCode - Branch code to validate
 * @returns {object} - {isValid: boolean, sanitized: string, error?: string}
 */
export function validateBranchCode(branchCode) {
  if (!branchCode || typeof branchCode !== 'string') {
    return { isValid: false, sanitized: '', error: 'Branch code is required' }
  }
  
  const sanitized = sanitizeString(branchCode, { maxLength: 50 }).toUpperCase()
  
  // Allow alphanumeric characters only
  if (!/^[A-Z0-9]+$/.test(sanitized)) {
    return { isValid: false, sanitized, error: 'Branch code contains invalid characters' }
  }
  
  if (sanitized.length < 2 || sanitized.length > 50) {
    return { isValid: false, sanitized, error: 'Branch code must be 2-50 characters' }
  }
  
  return { isValid: true, sanitized }
}

/**
 * Validate numeric input
 * @param {any} value - Value to validate as number
 * @param {object} options - Validation options {min, max, integer}
 * @returns {object} - {isValid: boolean, value: number, error?: string}
 */
export function validateNumber(value, options = {}) {
  const num = Number(value)
  
  if (isNaN(num) || !isFinite(num)) {
    return { isValid: false, value: 0, error: 'Invalid number' }
  }
  
  if (options.integer && !Number.isInteger(num)) {
    return { isValid: false, value: num, error: 'Must be an integer' }
  }
  
  if (options.min !== undefined && num < options.min) {
    return { isValid: false, value: num, error: `Must be at least ${options.min}` }
  }
  
  if (options.max !== undefined && num > options.max) {
    return { isValid: false, value: num, error: `Must be at most ${options.max}` }
  }
  
  return { isValid: true, value: num }
}

/**
 * Validate payment option
 * @param {string} paymentOption - Payment option to validate
 * @returns {object} - {isValid: boolean, sanitized: string, error?: string}
 */
export function validatePaymentOption(paymentOption) {
  const validOptions = ['Cash', 'Loan', 'Savings']
  
  if (!paymentOption || typeof paymentOption !== 'string') {
    return { isValid: false, sanitized: '', error: 'Payment option is required' }
  }
  
  const sanitized = sanitizeString(paymentOption, { maxLength: 20 })
  
  if (!validOptions.includes(sanitized)) {
    return { isValid: false, sanitized, error: 'Invalid payment option' }
  }
  
  return { isValid: true, sanitized }
}

/**
 * Validate order lines array
 * @param {array} lines - Order lines to validate
 * @returns {object} - {isValid: boolean, sanitized: array, error?: string}
 */
export function validateOrderLines(lines) {
  if (!Array.isArray(lines)) {
    return { isValid: false, sanitized: [], error: 'Order lines must be an array' }
  }
  
  if (lines.length === 0) {
    return { isValid: false, sanitized: [], error: 'At least one order line is required' }
  }
  
  if (lines.length > 100) {
    return { isValid: false, sanitized: [], error: 'Too many order lines (max 100)' }
  }
  
  const sanitized = []
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    
    if (!line || typeof line !== 'object') {
      return { isValid: false, sanitized: [], error: `Invalid order line at index ${i}` }
    }
    
    const skuValidation = validateSku(line.sku)
    if (!skuValidation.isValid) {
      return { isValid: false, sanitized: [], error: `Line ${i}: ${skuValidation.error}` }
    }
    
    const qtyValidation = validateNumber(line.qty, { min: 1, max: 9999, integer: true })
    if (!qtyValidation.isValid) {
      return { isValid: false, sanitized: [], error: `Line ${i}: ${qtyValidation.error}` }
    }
    
    sanitized.push({
      sku: skuValidation.sanitized,
      qty: qtyValidation.value
    })
  }
  
  return { isValid: true, sanitized }
}

/**
 * Rate limiting helper
 * @param {string} key - Unique key for rate limiting
 * @param {number} maxRequests - Maximum requests allowed
 * @param {number} windowMs - Time window in milliseconds
 * @returns {boolean} - Whether request is allowed
 */
const rateLimitStore = new Map()

export function checkRateLimit(key, maxRequests = 10, windowMs = 60000) {
  const now = Date.now()
  const windowStart = now - windowMs
  
  if (!rateLimitStore.has(key)) {
    rateLimitStore.set(key, [])
  }
  
  const requests = rateLimitStore.get(key)
  
  // Remove old requests outside the window
  const validRequests = requests.filter(timestamp => timestamp > windowStart)
  
  if (validRequests.length >= maxRequests) {
    return false
  }
  
  // Add current request
  validRequests.push(now)
  rateLimitStore.set(key, validRequests)
  
  return true
}

/**
 * Get client IP address from request
 * @param {Request} req - Next.js request object
 * @returns {string} - Client IP address
 */
export function getClientIP(req) {
  const forwarded = req.headers.get('x-forwarded-for')
  const realIP = req.headers.get('x-real-ip')
  const remoteAddr = req.headers.get('x-remote-addr')
  
  if (forwarded) {
    return forwarded.split(',')[0].trim()
  }
  
  return realIP || remoteAddr || 'unknown'
}

/**
 * Validate session token for API routes
 * @param {Request} request - The request object
 * @param {string} expectedRole - Expected role (optional, defaults to checking token validity)
 * @returns {object} - {valid: boolean, claims?: object, error?: string}
 */
export async function validateSession(request, expectedRole = null) {
  try {
    const adminToken = request.cookies.get('admin_token')?.value
    const repToken = request.cookies.get('rep_token')?.value
    const vendorToken = request.cookies.get('vendor_token')?.value
    const memberToken = request.cookies.get('member_token')?.value
    
    const candidates =
      expectedRole === 'rep'
        ? [
            { token: repToken, type: 'rep' },
            { token: adminToken, type: 'admin' },
          ]
        : expectedRole === 'admin'
          ? [
              { token: adminToken, type: 'admin' },
              { token: repToken, type: 'rep' },
            ]
          : expectedRole === 'vendor'
            ? [{ token: vendorToken, type: 'vendor' }]
            : expectedRole === 'member'
              ? [{ token: memberToken, type: 'member' }]
              : [
                  { token: adminToken, type: 'admin' },
                  { token: repToken, type: 'rep' },
                  { token: vendorToken, type: 'vendor' },
                  { token: memberToken, type: 'member' },
                ]

    const { verify } = await import('./signingEdge.js')

    for (const c of candidates) {
      if (!c.token) continue
      const claims = await verify(c.token)
      if (!claims) continue
      if (expectedRole && claims.role !== expectedRole) continue
      return { valid: true, claims, tokenType: c.type }
    }
    
    if (!adminToken && !repToken && !vendorToken && !memberToken) return { valid: false, error: 'No session token found' }
    return { valid: false, error: expectedRole ? `Expected role ${expectedRole}` : 'Invalid or expired token' }
  } catch (error) {
    console.error('Session validation error:', error)
    return { valid: false, error: 'Session validation failed' }
  }
}
