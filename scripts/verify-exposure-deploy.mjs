// Read-only: wait for the deploy of 2235c53, then confirm the live
// eligibility endpoint returns cycle-scoped exposure for the test member.
const BASE = process.env.PROD_BASE_URL || 'https://sales.cbncoopng.com'
const MEMBER = process.argv[2] || 'P03117'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

for (let attempt = 1; attempt <= 10; attempt += 1) {
  try {
    const res = await fetch(`${BASE}/api/members/eligibility?member_id=${MEMBER}`, { headers: { accept: 'application/json' } })
    const j = await res.json().catch(() => ({}))
    const e = j.eligibility || j
    if (j.ok) {
      console.log(`attempt ${attempt}: loanExposure=${Number(e.loanExposure || 0)} outstandingLoansTotal=${Number(e.outstandingLoansTotal || 0)} loanEligible=${Number(e.loanEligible || 0)}`)
      if (e.loanExposure !== 587138) { console.log('cycle-scoped exposure live ✓'); break }
    } else {
      console.log(`attempt ${attempt}: not ready (${res.status} ${j.error || ''})`)
    }
  } catch (e) {
    console.log(`attempt ${attempt}: ${e.message}`)
  }
  await sleep(30000)
}
