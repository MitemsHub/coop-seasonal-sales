# Food Distribution Loan System — Computation Walkthrough
Ground truth: `app/api/orders/route.js`, `app/api/members/eligibility/route.js`, DB function `create_food_order_atomic` (live). Settings quoted are **your live 2026 Q3 Distribution (cycle 3)** values.

## 0. Your live settings (cycle 3)
| Setting | Value |
|---|---|
| Loan interest rate | **11.5%** |
| Include interest in loan cap | **OFF (false)** — the cap counts principal only |
| Eligible cap — Active staff | **₦1,000,000** / cycle |
| Eligible cap — Retiree | **₦1,000,000** / cycle |
| Eligible cap — Pensioner | **₦1,000,000** / cycle |
| Grace (facility) cap — Active | **₦300,000** / cycle |
| Grace cap — Retiree | **0 (none)** |
| Grace cap — Pensioner | **₦300,000** / cycle |

## 1. The pieces (whole system)
**Savings rule:** `savingsEligible = 50% × savings`, zeroed completely while any loan is outstanding, minus any "savings exposure" (savings-based Food/Exhibition orders in the current calendar year).

**Loan base (savings-earned borrowing power):** `baseEligible = max(0, min(savings × 5, global_limit) − outstanding)` where outstanding = core loans + loan exposure of all modules (Food + Exhibition + RAM, calendar year, statuses Pending/Posted/Delivered).

**Cycle cap (your per-category ceilings):** how much loan principal a member, in a given staff category, may accumulate per cycle — `cap − cycleUsed` is the remaining ceiling, where cycleUsed counts their Pending/Posted/Delivered loan orders this cycle.

**Facility (grace, non-eligible pool):** if baseEligible is 0 (savings don't support a loan), grace caps serve as a separate, once-per-cycle pool. It is also ADDED to savings-based eligibility for fully eligible members ("universal pool").

**Full formula, applied inside the atomic DB function:**
```
totalBorrowable = baseEligible + graceCap
cycleCeiling    = eligibleCap − cycleLoanUsed
loanEligible    = min(totalBorrowable, cycleCeiling)
```
Order is blocked if the cart's cap-aware amount (see §2) exceeds `loanEligible`.

**Order status flow:** member submits → `Pending` → admin Posts → `Posted` → admin delivers → `Delivered`. Only *Pending/Posted/Delivered* count toward exposure/limits; `Cancelled`/`Rejected` orders release their exposure.

## 2. Interest computation (Include-Interest ON vs OFF)
- **Interest is added to the amount owed** at 11.5%: `interest = round(cartTotal × 0.115)`, `totalWithInterest = cartTotal + interest`. The **order's stored total** (what the member repays) ALWAYS includes interest.
- **The toggle (`Include interest in loan cap`) decides only** whether the cap check uses `totalWithInterest` or the raw principal:
  - **ON (include)**: a ₦300,000 principal order counts ₦334,500 against the ₦1,000,000 cap.
  - **OFF (exclude) — YOUR CURRENT SETTING**: the same order counts ₦300,000 against the cap. Interest is still appended to the order total; it just doesn't consume cap room.
- In BOTH cases the member repays the interest-inclusive amount.
- `/api/members/eligibility` mirrors the same rule, so the shop UI disables "Place order" and shows the exact remaining-limit error before the order route even runs. Server rejections are then only for genuine races (two tabs submitting simultaneously).

## 3. The atomic order gate (double-transaction protection)
1. Route validates the full policy (limits + caps + statuses) in Node.
2. Route calls DB function `create_food_order_atomic`, which runs inside a transaction doing `SELECT … FOR UPDATE` on the member row. Two simultaneous Loan orders cannot both grab the last ₦100,000: the first transaction wins the lock and inserts; the second re-computes eligibility with that order now visible and is rejected ("Cycle loan limit exceeded …"). Race-proof.
3. The order stores `cycle_id` and `food_loan_grace_used` (the once-per-cycle facility flag).
4. A 30-second explicit dedupe also exists in the route: an identical member + payment option + amount + Pending order returns the original order id with `duplicate: true` instead of creating a second one (double-click protection).

## 4. Scenarios with your real settings (₦1M eligible, ₦300k grace, 11.5%, exclude-interest cap)

**A. Active staff, savings ₦50,000, no outstanding loans**
- baseEligible = min(₦250,000, ∞) = ₦250,000
- loanEligible = min(₦250,000 + 300,000, 1,000,000 − 0) = **₦550,000**
- Order at ₦200,000 principal, Loan → interest ₦23,000, total repayable ₦223,000; cap consumes only ₦200,000 (toggle OFF), leaving ₦800,000 of cycle cap.

**B. Active staff, savings ₦200,000, one Delivered loan of ₦150,000 already this cycle**
- baseEligible = min(1,000,000, ∞) − 150,000 = ₦850,000
- remaining ceiling = 1,000,000 − 150,000 = ₦850,000
- loanEligible = min(850,000 + 300,000, 850,000) = **₦850,000** (the grace pool adds headroom on top of savings power, but the category cap is the absolute cylinder).

**C. Two orders in one cycle:**
- Order 1: ₦800,000 loan → cap room left = ₦200,000; loanEligible next time = min(base + 300k, 200k).
- Order 2: ₦400,000 → **REJECTED**: "Cycle loan limit of ₦1,000,000 exceeded. You already have ₦800,000 in this cycle; adding ₦400,000 would exceed the limit." (With include-interest ON, the message would quote ₦446,000 — the interest-inclusive number.)

**D. Active staff with NO savings (baseEligible = 0) — the grace/facility path**
- baseEligible = 0 → ordinary savings-derived loan is impossible.
- One Loan order ≤ ₦300,000 is allowed, flagged `food_loan_grace_used = TRUE`.
- A SECOND Loan in the same cycle is **rejected**: "Facility has already been used for this member in the current cycle" — even for a ₦5,000 top-up.

**E. Savings and loans never mix:** any loan outstanding (incl. Pending/Posted loan apps, across Food/Exhibition/RAM this calendar year) → Savings purchase is blocked outright: "Savings not allowed while loans outstanding."

**F. Retiree vs Pensioner vs Active:** identical formula, different cap columns. Currently Retiree grace = 0, so a retiree with insufficient savings gets **no** loan facility in cycle 3 (active/pensioner get ₦300,000).

**G. Cancelled/Rejected orders** release exposure immediately (next eligibility recalculation); Posted/Delivered keep consuming it.

## 5. Direct answers to your double-transaction questions
- **Double-click checkout / two identical carts within 30s** → the 30-second dedupe returns the first order (`duplicate: true`), never a second one.
- **Two different loan carts submitted at the same moment** → the FOR-UPDATE row lock serializes them; the second is recomputed against the first and rejected unless genuinely within limits.
- **Applying twice in a cycle deliberately** → allowed while cumulative loan principal stays under the ₦1,000,000 eligible cap (plus grace headroom if base > 0). NOT allowed once the cap is reached. Non-eligible members: facility is one-order-per-cycle, strictly.
- **Food + Exhibition + RAM in one year all count into the same exposure pools** — no module double-spending.

## 6. What changed in this pass (already applied)
- ✅ The DB's atomic `create_food_order_atomic` now accepts `p_cap_amount`, so the server-side cap check honours the Include-Interest toggle exactly as `/api/orders` does (migration `migrations/add-cap-amount-to-food-atomic.sql` applied; stale 11-arg overload dropped).
- ✅ Rejection messages now quote the exact cap-aware amount (principal when your toggle is OFF), not the interest-inflated number.
- ✅ Full test suite: 145/145 passing.
