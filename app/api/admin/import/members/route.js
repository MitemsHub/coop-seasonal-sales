// app/api/admin/import/members/route.js
import { NextResponse } from 'next/server'
import { createClient } from '../../../../../lib/supabaseServer'
import * as XLSX from 'xlsx/xlsx.mjs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// chunk helper
const chunk = (arr, size = 500) => {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export async function POST(req) {
  try {
    console.log('Members import request received')
    const supabase = createClient()
    const formData = await req.formData()
    const file = formData.get('file')
    console.log('File received:', file ? file.name : 'No file')
    if (!file) return NextResponse.json({ ok: false, error: 'file is required' }, { status: 400 })

    const buf = Buffer.from(await file.arrayBuffer())
    const wb = XLSX.read(buf, { type: 'buffer' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })

    // Expected headers (simplified):
    // member_id, full_name, email, alternative_email, grade, savings, loans, global_limit
    // email and alternative_email are OPTIONAL — a blank never touches what's stored.

    if (!rows.length) return NextResponse.json({ ok: false, error: 'No rows found' }, { status: 400 })

    // Load grade-based default limits once
    const { data: gradeRows, error: glErr } = await supabase
      .from('grade_limits')
      .select('grade, global_limit')
    if (glErr) return NextResponse.json({ ok: false, error: glErr.message }, { status: 500 })
    const gradeLimitByName = new Map(
      (gradeRows || []).map(g => [String(g.grade || '').trim().toLowerCase(), Number(g.global_limit || 0)])
    )

    // Canonical grade spellings from grade_limits — imported grades must match
    // the grade_limits rows or their members silently miss their grade default
    // (a real-world case: 'Assitant Director' typo'd in the source sheet).
    const canonicalGrades = new Map(
      (gradeRows || []).map(g => [
        String(g.grade || '').trim().toLowerCase().replace(/\s+/g, ' '),
        String(g.grade || '').trim(),
      ])
    )
    const normalizeGrade = (raw) => {
      let s = String(raw || '').trim().replace(/\s+/g, ' ')
      if (!s) return s
      // Fix the known misspelling, then snap to a canonical grade_limits row
      // when one matches (case/spacing-insensitive). Unknown grades pass
      // through cleaned so data quality problems stay detectable.
      const fixed = s.replace(/assitant/gi, 'assistant')
      return canonicalGrades.get(fixed.toLowerCase()) || fixed
    }

    // Build upsert rows from simplified template.
    // IMPORTANT: Do not overwrite branch_id/department_id/phone/email when not provided.
    const upsertRows = rows.map(r => {
      const member_id = String(r.member_id || '').trim()
      const full_name = String(r.full_name || '').trim()
      const grade = normalizeGrade(r.grade)
      const savings = Number(String(r.savings || '0').replace(/[, ]/g, '')) || 0
      const loans = Number(String(r.loans || '0').replace(/[, ]/g, '')) || 0
      let global_limit = Number(String(r.global_limit || '0').replace(/[, ]/g, '')) || 0

      // If global_limit not provided, default from grade_limits table
      if (!global_limit && grade) {
        const key = grade.toLowerCase().replace(/\s+/g, ' ').trim()
        const defaultLimit = gradeLimitByName.get(key)
        if (typeof defaultLimit === 'number') global_limit = defaultLimit
      }

      // Derive category from first character of member_id if available.
      // The members.category check allows A/R/P/E/C only, so an unknown prefix
      // (e.g. a TEST row) must actually map to one of those letters.
      const letter = (member_id ? member_id[0].toUpperCase() : 'A')
      const category = ['A', 'R', 'P', 'E', 'C'].includes(letter) ? letter : 'A'

      // Only include fields present in simplified template to avoid clearing existing data
      // portal_enabled: every imported member is portal-active. Re-uploading the
      // workbook re-enables anyone previously excluded (see add-portal-enabled migration).
      const row = {
        member_id,
        full_name,
        category,
        grade,
        savings,
        loans,
        global_limit,
        portal_enabled: true
      }

      // Email is optional: include it in the upsert ONLY when the sheet has a
      // value, so blanks never overwrite an existing email. Basic shape check
      // keeps obviously-wrong values ("john", spaces) from being written.
      const emailRaw = String(r.email || '').trim().toLowerCase()
      if (emailRaw && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
        row.email = emailRaw
      }

      // Alternative email is optional too — a second inbox to reach the member
      // at (OTP invites also go here). Blank never overwrites what's stored,
      // same rule as the primary email above.
      const altEmailRaw = String(r.alternative_email || '').trim().toLowerCase()
      if (altEmailRaw && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(altEmailRaw)) {
        row.alternative_email = altEmailRaw
      }

      return row
    })

    // Reject sheets that list the same member_id more than once (case- and
    // spacing-insensitive, e.g. 'a12345' vs 'A12345' vs ' A12345 '). With a
    // duplicate on the sheet, the last row would silently win the upsert and
    // the others' values would be lost, so the whole import is rejected
    // before anything is written.
    const seen = new Map() // normalized id → { count, rows[] (sheet row numbers) }
    const dups = new Map()
    rows.forEach((r, i) => {
      const key = String(r.member_id || '').trim().toUpperCase().replace(/\s+/g, '')
      if (!key) return
      const rowNum = i + 2 // +2: sheet row 1 is the header, data starts at row 2
      const entry = seen.get(key)
      if (entry) {
        entry.rows.push(rowNum)
        if (entry.count === 1) dups.set(key, entry) // remember row of first sighting too
        entry.count += 1
      } else {
        seen.set(key, { count: 1, rows: [rowNum] })
      }
    })
    if (dups.size) {
      const detail = [...dups.entries()]
        .slice(0, 10)
        .map(([id, e]) => `${id} (sheet rows ${e.rows.join(', ')})`)
        .join('; ')
      return NextResponse.json(
        {
          ok: false,
          error: `Duplicate member_id${dups.size === 1 ? '' : 's'} found in the sheet — every member must appear exactly once. Nothing was imported. ${dups.size > 10 ? `First 10 of ${dups.size}: ` : ''}${detail}`,
          duplicates: [...dups.entries()].map(([id, e]) => ({ member_id: id, sheet_rows: e.rows })),
        },
        { status: 400 }
      )
    }

    // Upsert in chunks
    let total = 0
    for (const part of chunk(upsertRows, 500)) {
      const { error: uErr, count } = await supabase
        .from('members')
        .upsert(part, { onConflict: 'member_id', ignoreDuplicates: false, count: 'exact' })
      if (uErr) return NextResponse.json({ ok: false, error: uErr.message }, { status: 500 })
      total += count || part.length
    }

    return NextResponse.json({ ok: true, imported: total })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Unknown error' }, { status: 500 })
  }
}