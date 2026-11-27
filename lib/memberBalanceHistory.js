// lib/memberBalanceHistory.js
// Traceability for member savings and loan balances. Every writer that changes
// those two fields records the old and new values here, with who made the
// change, which screen/process it came from, and when — so the admin app can
// show the trail instead of relying on a one-off backup table.
//
// A missing row means "nothing changed": buildMemberBalanceHistoryEntry returns
// null unless one of the two balances actually moved.
import { createClient } from './supabaseServer'

const money = (v) => (v == null || v === '' ? null : Math.round(Number(v) * 100) / 100)

/**
 * Build a history row from the member record before and after an update.
 * @param {object} before  – row with savings/loans before the write (may be empty for a new member)
 * @param {object} after   – row with savings/loans after the write
 * @param {{source?: string, changedBy?: string, note?: string}} meta
 * @returns {object|null}
 */
export function buildMemberBalanceHistoryEntry(before, after, { source = 'Members settings', changedBy = 'admin', note = '' } = {}) {
  const memberId = String(after?.member_id || before?.member_id || '').trim()
  if (!memberId) return null

  const oldSavings = money(before?.savings)
  const newSavings = money(after?.savings)
  const oldLoans = money(before?.loans)
  const newLoans = money(after?.loans)
  if (oldSavings === newSavings && oldLoans === newLoans) return null

  return {
    member_id: memberId,
    old_savings: oldSavings,
    new_savings: newSavings,
    old_loans: oldLoans,
    new_loans: newLoans,
    source: String(source || 'Members settings').slice(0, 120),
    changed_by: String(changedBy || 'admin').slice(0, 160),
    note: note ? String(note).slice(0, 500) : null,
  }
}

/**
 * Insert history rows (best effort — the balance change has already committed,
 * so a logging failure must not turn a successful save into an error).
 * @param {object[]} entries
 * @returns {Promise<boolean>} true when every chunk was written
 */
export async function logMemberBalanceHistory(entries, { chunkSize = 500 } = {}) {
  const list = (Array.isArray(entries) ? entries : [entries]).filter(Boolean)
  if (!list.length) return true
  try {
    const supabase = createClient()
    for (let i = 0; i < list.length; i += chunkSize) {
      const { error } = await supabase.from('member_balance_history').insert(list.slice(i, i + chunkSize))
      if (error) {
        console.error('member balance history insert failed:', error.message)
        return false
      }
    }
    return true
  } catch (e) {
    console.error('member balance history insert failed:', e?.message || e)
    return false
  }
}
