// app/api/members/auth/test-otp/route.js
// Diagnostic endpoint to test Supabase Auth OTP delivery.
//   GET  → returns Supabase Auth configuration status (URL config, SMTP, etc.)
//   POST { email? } → attempts to send a test OTP and returns detailed results
//
// Usage: GET /api/members/auth/test-otp  (check config)
//        POST /api/members/auth/test-otp { "email": "test@example.com" }  (test send)
//
// This endpoint is admin-only for security.
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createDbClient } from '@/lib/supabaseServer'
import { validateSession } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || ''

// Check basic environment variable configuration
function checkEnvConfig() {
  const issues = []

  if (!supabaseUrl) issues.push('NEXT_PUBLIC_SUPABASE_URL is not set')
  else if (supabaseUrl.includes('localhost') || supabaseUrl.includes('127.0.0.1'))
    issues.push('NEXT_PUBLIC_SUPABASE_URL points to localhost — will not work in production')

  if (!supabaseAnonKey) issues.push('NEXT_PUBLIC_SUPABASE_ANON_KEY is not set')
  if (!serviceKey) issues.push('SUPABASE_SERVICE_ROLE_KEY is not set')
  if (!siteUrl) issues.push('NEXT_PUBLIC_SITE_URL is not set — emailRedirectTo will use request origin')

  return issues
}

// GET — return configuration status
export async function GET(request) {
  try {
    const session = await validateSession(request, 'admin')
    if (!session.valid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const envIssues = checkEnvConfig()

    // Check Supabase Auth URL configuration via the admin API
    let authConfig = null
    try {
      const adminClient = createClient(supabaseUrl, serviceKey)
      const { data, error } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1 })
      authConfig = {
        canListUsers: !error,
        userCount: data?.users?.length || 0,
        error: error?.message || null,
      }
    } catch (e) {
      authConfig = { canListUsers: false, error: e.message }
    }

    // Check the site URL that would be used for emailRedirectTo
    const effectiveSiteUrl = siteUrl || '(would use request origin)'

    return NextResponse.json({
      ok: true,
      config: {
        supabaseUrl: supabaseUrl ? `${supabaseUrl.substring(0, 30)}...` : 'NOT SET',
        hasAnonKey: !!supabaseAnonKey,
        hasServiceKey: !!serviceKey,
        siteUrl: effectiveSiteUrl,
        emailRedirectTo: `${effectiveSiteUrl}/auth/callback`,
        envIssues,
        authConfig,
      },
      instructions: {
        checkRedirectUrls: `Go to Supabase Dashboard → Authentication → URL Configuration → Redirect URLs. Add: ${effectiveSiteUrl}/**`,
        checkSmtp: 'Go to Supabase Dashboard → Authentication → Emails → SMTP Settings. Verify host, port, username, password.',
        checkEmailTemplates: 'Go to Supabase Dashboard → Authentication → Emails → Templates. Make sure "Confirm signup" template is enabled.',
      },
    })
  } catch (e) {
    return NextResponse.json({ error: e.message || 'Internal server error' }, { status: 500 })
  }
}

// POST — test sending an OTP
export async function POST(request) {
  try {
    const session = await validateSession(request, 'admin')
    if (!session.valid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const envIssues = checkEnvConfig()
    if (envIssues.length > 0) {
      return NextResponse.json({
        ok: false,
        error: 'Environment configuration issues',
        issues: envIssues,
      }, { status: 500 })
    }

    const body = await request.json().catch(() => ({}))
    let testEmail = body.email || ''

    // If no email provided, look up a real member's email
    if (!testEmail) {
      const db = createDbClient()
      const { data: member } = await db
        .from('members')
        .select('email')
        .not('email', 'is', null)
        .neq('email', '')
        .limit(1)
        .maybeSingle()

      if (member?.email) {
        testEmail = member.email
      } else {
        return NextResponse.json({
          ok: false,
          error: 'No test email provided and no member emails found in the database.',
        }, { status: 400 })
      }
    }

    // Basic email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testEmail)) {
      return NextResponse.json({ ok: false, error: 'Invalid email format' }, { status: 400 })
    }

    const effectiveSiteUrl = siteUrl || request.nextUrl.origin
    const authSupabase = createClient(supabaseUrl, supabaseAnonKey)

    // Attempt to send OTP
    const startTime = Date.now()
    const { data, error: otpError } = await authSupabase.auth.signInWithOtp({
      email: testEmail.toLowerCase(),
      options: {
        data: { test: true },
        emailRedirectTo: `${effectiveSiteUrl}/auth/callback`,
      },
    })
    const durationMs = Date.now() - startTime

    if (otpError) {
      return NextResponse.json({
        ok: false,
        error: otpError.message,
        code: otpError.code,
        status: otpError.status,
        durationMs,
        emailDomain: testEmail.split('@')[1],
        diagnostics: {
          likelyCause: getLikelyCause(otpError),
          fix: getFix(otpError),
        },
      })
    }

    return NextResponse.json({
      ok: true,
      message: `OTP sent successfully to ${testEmail}`,
      durationMs,
      emailDomain: testEmail.split('@')[1],
      note: 'Check the recipient email inbox (and spam folder) for the OTP code.',
    })
  } catch (e) {
    return NextResponse.json({ error: e.message || 'Internal server error' }, { status: 500 })
  }
}

function getLikelyCause(error) {
  const msg = (error.message || '').toLowerCase()
  if (msg.includes('smtp') || msg.includes('email provider') || msg.includes('connection'))
    return 'SMTP server connection failed — check Supabase SMTP host, port, and credentials'
  if (msg.includes('rate limit') || msg.includes('too many'))
    return 'Rate limited — too many OTP requests. Wait and try again.'
  if (msg.includes('invalid email') || msg.includes('email address'))
    return 'Invalid email address format'
  if (msg.includes('email not confirmed'))
    return 'Supabase requires email confirmation first — check Auth settings'
  if (msg.includes('signup disabled') || msg.includes('sign up disabled'))
    return 'Sign-ups are disabled in Supabase Auth settings'
  if (msg.includes('email domain') || msg.includes('not allowed'))
    return 'Email domain not allowed — check Supabase Auth allowed domains'
  return 'Unknown error — check Supabase Dashboard → Auth → Logs for details'
}

function getFix(error) {
  const msg = (error.message || '').toLowerCase()
  if (msg.includes('smtp') || msg.includes('email provider'))
    return 'Go to Supabase Dashboard → Authentication → Emails → SMTP Settings and verify all fields. Make sure the password is correct and the server supports SSL on the configured port.'
  if (msg.includes('rate limit'))
    return 'Wait 5 minutes and try again. If this persists, check Supabase Auth rate limits.'
  if (msg.includes('signup disabled'))
    return 'Go to Supabase Dashboard → Authentication → Providers → Email and enable "Confirm email" or disable it depending on your flow.'
  return 'Check Supabase Dashboard → Authentication → Logs for the full error details.'
}
