// lib/foodSurveyMutations.js
// Shared create/edit logic for food-survey submissions, used by the public
// (/survey), rep-portal and admin API routes so validation never drifts.
import { randomBytes } from 'crypto'
import { removeSurveyPhotos } from './foodSurveyPhotos'

const MAX_ENTRIES = 60
const clean = (v, max) => String(v ?? '').trim().slice(0, max)

// Validates the line items. requirePhoto=false for edits — the admin may have
// deleted an image from an entry, and an edit that doesn't touch that entry
// must not fail because of it.
export function sanitizeEntries(entries, { requirePhoto = true } = {}) {
  if (!Array.isArray(entries) || !entries.length) {
    return { error: 'Add at least one item before submitting' }
  }
  if (entries.length > MAX_ENTRIES) {
    return { error: `Too many items (max ${MAX_ENTRIES})` }
  }
  const out = []
  for (const e of entries) {
    const name = clean(e?.item_name, 255)
    const category = clean(e?.category, 100) || 'Other'
    const price = Number(e?.price)
    const photoUrl = String(e?.photo_url || '').trim().slice(0, 2000) || null

    if (!name) return { error: 'Every item needs a name' }
    if (!Number.isFinite(price) || price < 0) return { error: `Invalid price for "${name}"` }
    if (requirePhoto && !photoUrl) return { error: `Please add a photo for "${name}"` }
    if (photoUrl && !/^(https?:\/\/|\/uploads\/)/i.test(photoUrl)) {
      return { error: `Invalid photo for "${name}"` }
    }
    out.push({
      catalog_id: Number.isInteger(Number(e?.catalog_id)) && Number(e?.catalog_id) > 0 ? Number(e.catalog_id) : null,
      item_name: name,
      category,
      price: Math.round(price * 100) / 100,
      photo_url: photoUrl,
    })
  }
  return { entries: out }
}

// Replaces all entries of a submission (delete + insert — surveys are small),
// then best-effort removes photos that no other entry references anymore.
export async function replaceEntries(supabase, submissionId, entries) {
  const { data: oldRows, error: oldErr } = await supabase
    .from('food_survey_entries')
    .select('id, photo_url')
    .eq('submission_id', submissionId)
  if (oldErr) return { error: oldErr.message }

  const { error: delErr } = await supabase
    .from('food_survey_entries')
    .delete()
    .eq('submission_id', submissionId)
  if (delErr) return { error: delErr.message }

  const rows = entries.map((e) => ({ ...e, submission_id: submissionId }))
  const { error: insErr } = await supabase.from('food_survey_entries').insert(rows)
  if (insErr) return { error: insErr.message }

  // Cleanup: old photo URLs that are not referenced by any new entry and not
  // used elsewhere in the table.
  const newUrls = new Set(entries.map((e) => e.photo_url).filter(Boolean))
  const dropped = (oldRows || [])
    .map((r) => r.photo_url)
    .filter((u) => u && !newUrls.has(u))
  if (dropped.length) {
    try {
      const { data: stillUsed } = await supabase
        .from('food_survey_entries')
        .select('photo_url')
        .in('photo_url', dropped)
      const used = new Set((stillUsed || []).map((r) => r.photo_url))
      const orphans = dropped.filter((u) => !used.has(u))
      if (orphans.length) await removeSurveyPhotos(supabase, orphans)
    } catch {
      // Best-effort only.
    }
  }
  return {}
}

export function newEditToken() {
  return randomBytes(24).toString('hex')
}

// Which cycle the food item survey is currently OPEN for:
//   admin set survey_open = true  AND  (no end date, or end date not passed).
// Cycles without dates stay open until the admin closes them — the same
// behaviour as the food distribution cycle (no open/close dates).
// Only one cycle can hold the open survey (enforced when the admin opens one).
// Returns { open, cycle, reason } with reason: 'open' | 'ended' | 'not_open' | 'error'.
export async function getOpenSurveyCycle(supabase) {
  try {
    const { data, error } = await supabase
      .from('cycles')
      .select('id, code, name, is_active, starts_at, ends_at, survey_open, created_at')
      .eq('survey_open', true)
      .order('id', { ascending: false })
    if (error) {
      // Migration not run yet — legacy behaviour, but date-aware: prefer the
      // active cycle, else the newest one, as long as its end date hasn't
      // passed (so a stale/closed cycle is never offered to reps). Survey
      // stays open while ANY cycle is still live.
      if (error.code === '42703' || /survey_open/i.test(error.message || '')) {
        try {
          const { data: all, error: lErr } = await supabase
            .from('cycles')
            .select('id, code, name, is_active, starts_at, ends_at, created_at')
            .order('id', { ascending: false })
          if (!lErr && all?.length) {
            const live = all.filter((c) => !c.ends_at || endsAtMs(c.ends_at) > Date.now())
            const pick = live.find((c) => c.is_active) || live[0]
            if (pick) return { open: true, cycle: pick, reason: 'open' }
            return { open: false, cycle: all[0], reason: 'ended' }
          }
        } catch {}
        const legacy = await resolveActiveCycle(supabase)
        return { open: true, cycle: legacy, reason: 'open' }
      }
      console.error('Survey status error:', error)
      return { open: false, cycle: null, reason: 'error' }
    }

    const list = data || []
    const open = list.find((c) => !c.ends_at || endsAtMs(c.ends_at) > Date.now())
    if (open) return { open: true, cycle: open, reason: 'open' }
    if (list.length) return { open: false, cycle: list[0], reason: 'ended' }
    return { open: false, cycle: null, reason: 'not_open' }
  } catch (e) {
    console.error('Survey status error:', e)
    return { open: false, cycle: null, reason: 'error' }
  }
}

// End-of-day semantics for date-only values ('YYYY-MM-DD' stores as UTC
// midnight; the survey stays usable for the whole of the end date).
function endsAtMs(value) {
  const t = new Date(value).getTime()
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? t + 24 * 60 * 60 * 1000 : t
}

// User-facing reason a survey is closed (matches getOpenSurveyCycle reasons).
export function surveyClosedMessage(status) {
  const cycleName = status?.cycle?.name || 'this cycle'
  if (status?.reason === 'ended' && status?.cycle?.ends_at) {
    const d = new Date(status.cycle.ends_at)
    const when = Number.isNaN(d.getTime())
      ? status.cycle.ends_at
      : d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })
    return `The survey for ${cycleName} closed on ${when} and is no longer accepting changes.`
  }
  if (status?.reason === 'not_open') {
    return 'The survey is not open right now. Ask the admin to open it for the current food cycle.'
  }
  if (status?.reason === 'error') return 'Could not verify the survey status — please try again.'
  return 'The survey is currently closed.'
}

// Phone on the About-you section — optional, but validated when given.
export function sanitizePhone(v) {
  const raw = String(v ?? '').trim().slice(0, 30)
  if (!raw) return { phone: '' }
  const cleaned = raw.replace(/[\s\-().]/g, '')
  if (!/^\+?\d{7,15}$/.test(cleaned)) {
    return { error: 'Enter a valid phone number — digits only, 7 to 15 digits (you can start with +).' }
  }
  return { phone: cleaned }
}

// True when migrations/cycle-survey-open.sql (phone column) has been run on
// food_survey_submissions. Cached per server process so pre-migration deploys
// keep saving submissions (without the phone) instead of erroring.
let phoneCol // undefined = unknown, true / false once probed
export async function submissionsHasPhone(supabase) {
  if (phoneCol !== undefined) return phoneCol
  try {
    const { error } = await supabase.from('food_survey_submissions').select('phone').limit(1)
    if (!error) {
      phoneCol = true
      return true
    }
    if (error.code === '42703' || /phone/i.test(error.message || '')) {
      phoneCol = false
      return false
    }
  } catch {}
  return true // unknown — optimistic, real errors surface on write
}

// Best-effort cycle resolution for a submission: the active food cycle, else
// the most recently created one (surveys are usually filled BEFORE the cycle
// opens, so there may be no active cycle yet). Null when no cycle exists.
export async function resolveActiveCycle(supabase) {
  try {
    const { data, error } = await supabase
      .from('cycles')
      .select('id, name')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
    if (!error) return data?.[0] || null
  } catch {}
  try {
    const { data } = await supabase
      .from('cycles')
      .select('id, name')
      .order('created_at', { ascending: false })
      .limit(1)
    return data?.[0] || null
  } catch {
    return null
  }
}
