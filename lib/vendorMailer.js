// lib/vendorMailer.js
// Sends exhibition vendor login details over the SMTP account the app already
// uses for contact mail. Configuration stays server-side only.
import nodemailer from 'nodemailer'

const REQUIRED = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS']

export function missingMailConfig() {
  return REQUIRED.filter((name) => !String(process.env[name] || '').trim())
}

export function isMailConfigured() {
  return missingMailConfig().length === 0
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function loginEmailText({ vendorName, code, passcode, loginUrl, cycleName, reminder }) {
  // Reminders never carry a passcode: the one already in the vendor's inbox
  // stays valid, so a reminder cannot lock them out.
  if (reminder) {
    return [
      `Hello ${vendorName || 'there'},`,
      '',
      `A quick reminder that your stand account${cycleName ? ` for ${cycleName}` : ''} is ready.`,
      '',
      `Sign in: ${loginUrl}`,
      `Select your hub: ${vendorName}`,
      `Vendor code: ${code}`,
      '',
      'Your passcode is the one from the email we sent earlier — it still works.',
      'If you cannot find it, contact the Coop admin and they will reset it for you.',
      '',
      'Keep this message private. If you did not expect it, contact the Coop admin.',
      '',
      'Need help? customerservice@cbncoopng.com',
      '',
      '© 2026 CBN Coop Seasonal Sales',
    ].join('\n')
  }

  return [
    `Hello ${vendorName || 'there'},`,
    '',
    `Your stand account${cycleName ? ` for ${cycleName}` : ''} is ready.`,
    '',
    `Sign in: ${loginUrl}`,
    `Select your hub: ${vendorName}`,
    `Vendor code: ${code}`,
    `Passcode: ${passcode}`,
    '',
    'At sign-in, select your hub, then enter the passcode above.',
    '',
    'Keep this message private. If you did not expect it, contact the Coop admin.',
    '',
    'Need help? customerservice@cbncoopng.com',
    '',
    '© 2026 CBN Coop Seasonal Sales',
  ].join('\n')
}

// Same visual language as the member authentication email: warm off-white
// background, white rounded card, centred brand header and a soft credential
// block. Table-based markup with inline styles keeps Gmail/Outlook consistent.
export function loginEmailHtml({ vendorName, code, passcode, loginUrl, cycleName, reminder }) {
  const name = escapeHtml(vendorName || 'there')
  const cycle = escapeHtml(cycleName || '')
  const safeCode = escapeHtml(code)
  const safePasscode = escapeHtml(passcode)
  const safeUrl = escapeHtml(loginUrl)

  const standAccount = `stand account${cycle ? ` for <strong style="color:#141414;">${cycle}</strong>` : ''}`
  const introBlock = `<p style="margin:0 0 24px;font-size:14px;font-weight:400;color:#57534e;line-height:1.6;">
                ${reminder
                  ? `This is a reminder that your ${standAccount} is ready. Your sign-in details have not changed.`
                  : `Your ${standAccount} is ready. Use the details below to sign in to the vendor portal and manage your products, prices and orders.`}
              </p>`
  // A reminder repeats the code and the steps but never restates or replaces
  // the passcode, so the details the vendor already holds keep working.
  const passcodeSection = reminder
    ? `<div style="border-top:1px solid #e7e5e1;margin:18px 0;"></div>

                    <p style="margin:0 0 8px;font-size:10px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#76706a;">
                      Your passcode
                    </p>
                    <p style="margin:0;font-size:13px;color:#57534e;line-height:1.6;">
                      Unchanged — use the passcode from our earlier email. If you cannot find it, contact the Coop admin and they will reset it for you.
                    </p>`
    : `<div style="border-top:1px solid #e7e5e1;margin:18px 0;"></div>

                    <p style="margin:0 0 10px;font-size:10px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#76706a;">
                      Your passcode
                    </p>
                    <p style="margin:0;font-size:26px;font-weight:700;letter-spacing:1px;color:#1d6746;font-family:'Courier New',Courier,monospace;line-height:1.1;">
                      ${safePasscode}
                    </p>`

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light only">
  <title>Vendor Login</title>
  <!--[if mso]>
  <style>table,td{font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif!important}</style>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#fafaf9;font-family:'Geist Sans','Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%;">

  <div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;color:transparent;">
    Your exhibition stand login details are ready.
  </div>

  <!-- Outer wrapper -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#fafaf9;">
    <tr>
      <td align="center" style="padding:40px 16px 56px;">

        <!-- Card -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;background-color:#ffffff;border:1px solid #e7e5e1;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px 0 rgba(16,15,12,0.05),0 1px 2px 0 rgba(16,15,12,0.06);">

          <!-- ─── Brand header ─── -->
          <tr>
            <td style="background-color:#1d6746;padding:32px 32px 28px;text-align:center;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 14px;">
                <tr>
                  <td style="width:48px;height:48px;background-color:rgba(255,255,255,0.12);border-radius:12px;text-align:center;line-height:48px;font-size:22px;color:#ffffff;">
                    &#128722;
                  </td>
                </tr>
              </table>
              <h1 style="margin:0;font-size:20px;font-weight:650;letter-spacing:-0.02em;color:#ffffff;line-height:1.2;">
                CBN Coop Seasonal Sales
              </h1>
              <p style="margin:6px 0 0;font-size:12px;font-weight:500;letter-spacing:0.05em;text-transform:uppercase;color:rgba(255,255,255,0.7);">
                Exhibition Vendor Login
              </p>
            </td>
          </tr>

          <!-- ─── Body ─── -->
          <tr>
            <td style="padding:32px 32px 24px;">
              <p style="margin:0 0 6px;font-size:15px;font-weight:600;color:#141414;line-height:1.4;">
                Hello ${name},
              </p>
              ${introBlock}

              <!-- ─── Login details block ─── -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f5f4f2;border:1px solid #e7e5e1;border-radius:12px;margin:0 0 24px;">
                <tr>
                  <td style="padding:22px 20px 18px;text-align:center;">
                    <p style="margin:0 0 10px;font-size:10px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#76706a;">
                      Your vendor code
                    </p>
                    <p style="margin:0;font-size:26px;font-weight:700;letter-spacing:2px;color:#1d6746;font-family:'Courier New',Courier,monospace;line-height:1.1;">
                      ${safeCode}
                    </p>

                    ${passcodeSection}
                  </td>
                </tr>
              </table>

              <!-- ─── Sign-in action ─── -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 22px;">
                <tr>
                  <td style="background-color:#1d6746;border-radius:10px;text-align:center;">
                    <a href="${safeUrl}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">
                      Sign in to your stand &rarr;
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 14px;font-size:13px;color:#57534e;line-height:1.6;">
                At sign-in, select <strong style="color:#141414;">${name}</strong> as your hub, then enter ${reminder ? 'the passcode from our earlier email' : 'the passcode above'}.
                If the button does not work, copy this link into your browser:
                <a href="${safeUrl}" style="color:#1d6746;font-weight:600;text-decoration:none;word-break:break-all;">${safeUrl}</a>
              </p>
              <p style="margin:0;font-size:13px;color:#57534e;line-height:1.6;">
                Keep this message private. If you did not expect this, you can safely contact the Coop admin.
              </p>
            </td>
          </tr>

          <!-- ─── Divider ─── -->
          <tr>
            <td style="padding:0 32px;">
              <div style="border-top:1px solid #e7e5e1;margin:0;"></div>
            </td>
          </tr>

          <!-- ─── Footer ─── -->
          <tr>
            <td style="padding:20px 32px 28px;">
              <p style="margin:0 0 6px;font-size:12px;color:#76706a;text-align:center;">
                &copy; 2026 CBN Coop Seasonal Sales
              </p>
              <p style="margin:0;font-size:12px;color:#76706a;text-align:center;">
                Need help?&nbsp;
                <a href="mailto:customerservice@cbncoopng.com" style="color:#1d6746;font-weight:600;text-decoration:none;">customerservice@cbncoopng.com</a>
              </p>
            </td>
          </tr>

        </table>
        <!-- /Card -->

      </td>
    </tr>
  </table>
  <!-- /Outer wrapper -->

</body>
</html>`
}

export async function sendVendorLoginEmail({ to, vendorName, code, passcode, loginUrl, cycleName, reminder = false }) {
  const missing = missingMailConfig()
  if (missing.length) {
    const err = new Error(`Email is not configured. Missing ${missing.join(', ')}.`)
    err.code = 'MAIL_NOT_CONFIGURED'
    throw err
  }

  const port = Number(process.env.SMTP_PORT)
  const fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER
  const secure =
    String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  })

  await transporter.sendMail({
    from: `CBN Coop Exhibition <${fromEmail}>`,
    to,
    subject: `${reminder ? 'Reminder: your vendor login' : 'Your vendor login'}${cycleName ? ` — ${cycleName}` : ''}`,
    text: loginEmailText({ vendorName, code, passcode, loginUrl, cycleName, reminder }),
    html: loginEmailHtml({ vendorName, code, passcode, loginUrl, cycleName, reminder }),
  })
}
