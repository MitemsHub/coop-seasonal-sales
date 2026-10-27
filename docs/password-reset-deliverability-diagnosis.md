# Password-reset email delivery — diagnosis (23 Oct 2026)

## Symptom
Member E00076 (`emmanuelmitti1998@gmail.com`) never receives password-reset
emails from the member login page — not in inbox, not in spam, not in All
Mail. OTP login codes arrive fine.

## What was verified (all on the Supabase side passed)
- App code path: `MemberAuth.jsx` → `POST /api/members/auth/forgot-password`
  → Supabase `resetPasswordForEmail` — correct, no errors.
- Supabase Auth logs show three `/recover` requests completing with
  `status 200`, action `user_recovery_requested`, **zero error-level logs**.
- `recovery_sent_at` on the auth user advanced on each send (01:40, 01:43,
  01:56 UTC) — GoTrue handed each message to SMTP without error.
- The stored `MAILER_TEMPLATES_RECOVERY_CONTENT` is a complete, valid HTML
  document (5,662 chars). A plain-text probe template was swapped in and a
  test send made at 01:56 UTC — that message *also* did not arrive, so the
  template is not the cause. The original template was restored
  (backup: [recovery-template-supabase-current.html](./recovery-template-supabase-current.html)).
- E00076's auth account is bound to `emmanuelmitti1998@gmail.com`;
  `ecmitti@cbncoopng.com` is a *separate* auth user not linked to the member.
  Resets for E00076 always go to the Gmail address.

## Root cause (current best evidence)
Custom SMTP sends all auth mail through the coop's own server
`mail.cbncoopng.com` (HostGator shared hosting, 108.179.232.250), port 465.

- SPF: `v=spf1 a mx include:websitewelcome.com include:sendersrv.com ~all` (valid)
- DKIM: `default._domainkey.cbncoopng.com` has a 2048-bit key (cpanel selector record empty)
- DMARC: two conflicting `_dmarc` TXT records, both `p=none`

Shared-hosting IPs receive poor Gmail sender reputation. Gmail **silently
discards account-recovery-style messages** from low-reputation sources
before they reach Spam, while still delivering short verification-code
emails. This uniquely matches every observed symptom: OTP delivery works,
both a styled and a plain-text reset vanish, Supabase reports success, no
bounces seen.

## Recommended fix
Route Supabase auth email (Authentication → Emails → SMTP Settings) through
a proper transactional email provider instead of the shared-hosting server:

- **Brevo** — 300 emails/day free, works as plain SMTP in Supabase.
- **Resend** or **SendGrid** — also suitable (100 emails/day free tiers).

Steps (any provider):
1. Create the account and verify the sending domain `cbncoopng.com`
   (add the provider's SPF extension and DKIM TXT records in DNS).
2. In Supabase → Authentication → Emails → SMTP Settings, enable custom
   SMTP with the provider's host/port/username/password (usually a
   subdomain like `smtp-relay.brevo.com`, port 587, an SMTP key).
3. Send a test: forgot-password for a member, confirm arrival in Gmail.

## Non-issues / already checked
- The reset template is not corrupted (verified via management API,
  not the dashboard editor preview, which truncates for display).
- No Supabase rate limit was hit (they would surface as 429s in Auth logs).
- The `ecmitti@cbncoopng.com` auth user does not receive resets for E00076
  by design; repointing the member's auth account is a separate decision.

## Code change (27 Oct 2026)
`POST /api/members/auth/forgot-password` now sends a 6-digit **code** instead
of a link, and the login UI runs the existing sign-up screens
(`ENTER_OTP` → `SET_PASSWORD`) in "reset" mode: verify the code → type a new
password → signed in. The account is **not** deleted and the member does not
re-sign up; `set-password` updates the same auth user.

Two rounds:
1. First pass used `signInWithOtp` — proven delivery, but that always renders
   Supabase's **Magic Link** template, so the email arrived saying "complete
   your sign-in to the member portal".
2. Now it uses `resetPasswordForEmail`, verified as `type: 'recovery'`, so it
   renders the separate **Reset password** template instead. GoTrue hands that
   template `{{ .Token }}` — the 6-digit code, not the link token — giving a
   genuine reset-code email (see [reset-password-email-template.html](./reset-password-email-template.html)).

⚠️ **Delivery of this variant is NOT yet proven.** What Gmail was discarding
was the recovery *link*; a recovery *code* in the same template has never been
confirmed to arrive. Send one forgot-password for E00076 and confirm it lands
before trusting it. If it does not arrive, restoring the `signInWithOtp` send
from commit `18b5982` puts delivery back on the proven path — `verify-otp`
already defaults `type` to `'email'`, so that revert is confined to
`forgot-password/route.js`.

## Files
- Template backup: [recovery-template-supabase-current.html](./recovery-template-supabase-current.html)
- **Supabase "Reset password" template (code-based, current):**
  [reset-password-email-template.html](./reset-password-email-template.html)
- **Supabase "Magic Link" template (sign-up/sign-in, unchanged):**
  [otp-email-template.html](./otp-email-template.html)
- Legacy link-based sources: [reset-password-template.html](./reset-password-template.html)
