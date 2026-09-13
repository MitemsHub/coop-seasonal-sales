// app/api/admin/import/members/schema/route.js
// Single source of truth for the member import template.
// The frontend fetches this to build the Excel template and the "Expected columns" description.
// If you add a column to the import route, add it here and the template updates automatically.
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Column definitions — add new columns here and both the template + description update automatically.
const COLUMNS = [
  {
    key: 'member_id',
    label: 'Member ID',
    type: 'text',
    required: true,
    description: 'Unique staff/member identifier (e.g. A12345)',
    sample: 'A12345',
  },
  {
    key: 'full_name',
    label: 'Full Name',
    type: 'text',
    required: true,
    description: 'Member\'s full name',
    sample: 'John Doe',
  },
  {
    key: 'grade',
    label: 'Grade',
    type: 'text',
    required: false,
    description: 'Staff grade (used for default loan limit lookup)',
    sample: 'Director',
  },
  {
    key: 'savings',
    label: 'Savings',
    type: 'number',
    required: false,
    description: 'Current savings balance (₦)',
    sample: 2000000,
  },
  {
    key: 'loans',
    label: 'Loans',
    type: 'number',
    required: false,
    description: 'Current loan balance (₦)',
    sample: 0,
  },
  {
    key: 'global_limit',
    label: 'Global Limit',
    type: 'number',
    required: false,
    description: 'Maximum loan limit (₦). Defaults to grade limit if blank.',
    sample: 40000000,
  },
]

export async function GET() {
  return NextResponse.json({
    ok: true,
    columns: COLUMNS,
    // Convenience: just the keys in order (what the spreadsheet headers should be)
    headers: COLUMNS.map((c) => c.key),
    // Single sample row for the template
    sampleRow: Object.fromEntries(COLUMNS.map((c) => [c.key, c.sample])),
    // Human-readable description for the UI
    description: `Expected columns: ${COLUMNS.map((c) => c.key).join(', ')}`,
  })
}
