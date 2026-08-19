import { NextResponse } from 'next/server'
import nodemailer from 'nodemailer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function cleanText(value, { max = 5000 } = {}) {
  const v = String(value || '').replace(/\r\n/g, '\n').trim()
  if (!v) return ''
  return v.length > max ? v.slice(0, max) : v
}

function isValidEmail(email) {
  const e = String(email || '').trim()
  if (!e) return true
  if (e.length > 254) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)
}

function requireEnv(name) {
  const v = process.env[name]
  if (!v) throw new Error(`Missing server configuration: ${name}`)
  return v
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}))

    const name = cleanText(body.name, { max: 120 })
    const phone = cleanText(body.phone, { max: 40 })
    const email = cleanText(body.email, { max: 254 })
    const requests = cleanText(body.requests, { max: 5000 })

    if (!name) return NextResponse.json({ ok: false, error: 'Name is required' }, { status: 400 })
    if (!phone && !email) return NextResponse.json({ ok: false, error: 'Phone number or email is required' }, { status: 400 })
    if (!requests) return NextResponse.json({ ok: false, error: 'Request is required' }, { status: 400 })
    if (!isValidEmail(email)) return NextResponse.json({ ok: false, error: 'Invalid email address' }, { status: 400 })

    const toEmail = process.env.CONTACT_TO_EMAIL || 'chuksmitti@gmail.com'
    const smtpHost = requireEnv('SMTP_HOST')
    const smtpPort = Number(requireEnv('SMTP_PORT'))
    const smtpUser = requireEnv('SMTP_USER')
    const smtpPass = requireEnv('SMTP_PASS')
    const fromEmail = process.env.SMTP_FROM || smtpUser
    const secure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || smtpPort === 465

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    })

    const subject = `New enquiry: ${name}`
    const text = [
      'New contact request from the app:',
      '',
      `Name: ${name}`,
      `Phone: ${phone || '-'}`,
      `Email: ${email || '-'}`,
      '',
      'Request:',
      requests,
    ].join('\n')

    await transporter.sendMail({
      from: `MitemsHub Contact <${fromEmail}>`,
      to: toEmail,
      replyTo: email || undefined,
      subject,
      text,
    })

    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to send message' }, { status: 500 })
  }
}

