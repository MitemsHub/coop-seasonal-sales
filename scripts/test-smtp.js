#!/usr/bin/env node
/**
 * SMTP Diagnostic Script for Supabase Auth OTP
 * 
 * Usage: node scripts/test-smtp.js <email>
 * 
 * This script tests:
 * 1. Environment variable configuration
 * 2. Supabase Auth connection
 * 3. OTP sending via signInWithOtp
 * 4. Common configuration issues
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Load .env.local
config({ path: join(__dirname, '..', '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL

const testEmail = process.argv[2]

console.log('\n🔍 Supabase OTP Diagnostic Test\n')
console.log('=' .repeat(50))

// 1. Check environment variables
console.log('\n📋 Step 1: Checking environment variables...')
const envIssues = []
if (!supabaseUrl) envIssues.push('❌ NEXT_PUBLIC_SUPABASE_URL is not set')
else if (supabaseUrl.includes('localhost')) envIssues.push('⚠️  NEXT_PUBLIC_SUPABASE_URL points to localhost')
else console.log(`✅ NEXT_PUBLIC_SUPABASE_URL: ${supabaseUrl.substring(0, 40)}...`)

if (!supabaseAnonKey) envIssues.push('❌ NEXT_PUBLIC_SUPABASE_ANON_KEY is not set')
else console.log('✅ NEXT_PUBLIC_SUPABASE_ANON_KEY: [set]')

if (!serviceKey) envIssues.push('❌ SUPABASE_SERVICE_ROLE_KEY is not set')
else console.log('✅ SUPABASE_SERVICE_ROLE_KEY: [set]')

if (!siteUrl) {
  envIssues.push('⚠️  NEXT_PUBLIC_SITE_URL is not set (will use request origin)')
  console.log('⚠️  NEXT_PUBLIC_SITE_URL: not set')
} else {
  console.log(`✅ NEXT_PUBLIC_SITE_URL: ${siteUrl}`)
}

if (envIssues.length > 0) {
  console.log('\n⚠️  Environment issues found:')
  envIssues.forEach(i => console.log(`   ${i}`))
}

// 2. Check Supabase Auth configuration
console.log('\n📋 Step 2: Checking Supabase Auth configuration...')
const adminClient = createClient(supabaseUrl, serviceKey)

try {
  const { data, error } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1 })
  if (error) {
    console.log('❌ Failed to connect to Supabase Auth:', error.message)
    console.log('   → Check SUPABASE_SERVICE_ROLE_KEY')
  } else {
    console.log('✅ Supabase Auth connection: OK')
  }
} catch (e) {
  console.log('❌ Connection error:', e.message)
}

// 3. Test OTP sending
if (!testEmail) {
  console.log('\n⚠️  No email provided. Usage: node scripts/test-smtp.js <email>')
  console.log('   Example: node scripts/test-smtp.js test@example.com')
  console.log('\n' + '='.repeat(50))
  console.log('To test OTP sending, provide an email address as argument.\n')
  process.exit(0)
}

console.log(`\n📋 Step 3: Testing OTP sending to ${testEmail}...`)

const authClient = createClient(supabaseUrl, supabaseAnonKey)
const effectiveSiteUrl = siteUrl || 'https://sales.cbncoopng.com'

const startTime = Date.now()
const { data, error: otpError } = await authClient.auth.signInWithOtp({
  email: testEmail.toLowerCase(),
  options: {
    data: { test: true },
    emailRedirectTo: `${effectiveSiteUrl}/auth/callback`,
  },
})
const durationMs = Date.now() - startTime

if (otpError) {
  console.log('❌ OTP sending failed!')
  console.log(`   Error: ${otpError.message}`)
  console.log(`   Code: ${otpError.code}`)
  console.log(`   Status: ${otpError.status}`)
  console.log(`   Duration: ${durationMs}ms`)
  
  console.log('\n🔧 Likely cause:')
  const msg = (otpError.message || '').toLowerCase()
  
  if (msg.includes('smtp') || msg.includes('email provider') || msg.includes('connection')) {
    console.log('   SMTP server connection failed')
    console.log('   → Check Supabase Dashboard → Authentication → Emails → SMTP Settings')
    console.log('   → Verify host, port, username, and password are correct')
    console.log('   → Make sure the SMTP password matches your email account password')
  } else if (msg.includes('rate limit') || msg.includes('too many')) {
    console.log('   Rate limited — too many OTP requests')
    console.log('   → Wait 5 minutes and try again')
  } else if (msg.includes('invalid email') || msg.includes('email address')) {
    console.log('   Invalid email address format')
  } else if (msg.includes('signup disabled') || msg.includes('sign up disabled')) {
    console.log('   Sign-ups are disabled in Supabase Auth settings')
    console.log('   → Go to Supabase Dashboard → Authentication → Providers → Email')
    console.log('   → Enable "Confirm email" or "Enable sign ups"')
  } else if (msg.includes('email domain') || msg.includes('not allowed')) {
    console.log('   Email domain not allowed')
    console.log('   → Go to Supabase Dashboard → Authentication → Providers → Email')
    console.log('   → Check "Allowed email domains" setting')
  } else {
    console.log('   Unknown error — check Supabase Dashboard → Authentication → Logs')
  }
  
  process.exit(1)
} else {
  console.log('✅ OTP sent successfully!')
  console.log(`   Duration: ${durationMs}ms`)
  console.log(`   Email domain: ${testEmail.split('@')[1]}`)
  
  console.log('\n📬 Check the recipient email inbox (and spam folder) for the OTP code.')
  console.log('   The email should arrive within 1-2 minutes.')
  
  console.log('\n🔧 If you don\'t receive the email:')
  console.log('   1. Check spam/junk folder')
  console.log('   2. Verify the SMTP password matches your email account password')
  console.log('   3. Check Supabase Dashboard → Authentication → Logs for delivery status')
  console.log('   4. Make sure NEXT_PUBLIC_SITE_URL is set in Vercel environment variables')
}

console.log('\n' + '='.repeat(50))
console.log('Diagnostic complete.\n')
