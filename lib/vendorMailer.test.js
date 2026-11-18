import { describe, it, expect } from 'vitest'
import { loginEmailHtml, loginEmailText } from './vendorMailer'

const loginUrl = 'https://sales.cbncoopng.com/vendor/login'
const base = {
  vendorName: 'Mitams Foods',
  code: 'V0001',
  passcode: 'K7Q2M9',
  loginUrl,
  cycleName: 'COOP EXHIBITION 2026',
}

describe('vendor login email', () => {
  it('keeps a complete plain-text fallback', () => {
    const text = loginEmailText(base)
    expect(text).toContain('Hello Mitams Foods')
    expect(text).toContain('COOP EXHIBITION 2026')
    expect(text).toContain('Vendor code: V0001')
    expect(text).toContain('Passcode: K7Q2M9')
    expect(text).toContain(loginUrl)
  })

  it('matches the authentication email design and shows the credentials', () => {
    const html = loginEmailHtml(base)
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('background-color:#fafaf9')
    expect(html).toContain('background-color:#1d6746')
    expect(html).toContain('&#128722;')
    expect(html).toContain('CBN Coop Seasonal Sales')
    expect(html).toContain('Exhibition Vendor Login')
    expect(html).toContain('V0001')
    expect(html).toContain('K7Q2M9')
    expect(html).toContain('COOP EXHIBITION 2026')
    expect(html).toContain(`href="${loginUrl}"`)
    expect(html).toContain('Sign in to your stand')
    expect(html).toContain('customerservice@cbncoopng.com')
  })

  it('escapes vendor-controlled text in the HTML', () => {
    const html = loginEmailHtml({
      ...base,
      vendorName: '<script>alert(1)</script>',
      cycleName: 'A & B',
    })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('A &amp; B')
  })
})
