// lib/foodSurveyCatalog.js
// The survey catalog gained a `unit` column (bag, carton, gallon …) via
// migrations/add-food-survey-unit.sql. If a route selects or writes `unit`
// before that migration has been run, Postgres answers 42703
// ("column food_survey_catalog.unit does not exist") and the whole survey
// form would 500.
//
// supportsUnit() probes the column once and caches the answer: positive
// results for 5 minutes, negative ones for 30 seconds, so the catalog picks
// the column up within half a minute of the migration landing — without an
// extra probe on every single request once it is there.
const POSITIVE_TTL_MS = 5 * 60 * 1000
const NEGATIVE_TTL_MS = 30 * 1000

let probe = { at: 0, ok: false }

export async function supportsUnit(supabase) {
  const age = Date.now() - probe.at
  if (probe.ok && age < POSITIVE_TTL_MS) return true
  if (!probe.ok && age < NEGATIVE_TTL_MS) return false
  const { error } = await supabase.from('food_survey_catalog').select('unit').limit(1)
  probe = { at: Date.now(), ok: !error }
  return probe.ok
}
