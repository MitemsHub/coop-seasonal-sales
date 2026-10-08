// lib/schema.js
// JSON-LD structured data injected into the page <head> by app/layout.jsx.
// The is-agentic audit required (a) JSON-LD identity on the homepage and
// (b) a complete Organization schema — contactPoint (email/phone/contactType)
// and address (PostalAddress) — so AI can verify the business programmatically.

import { SITE_URL } from './siteMetadata.js'

const DESCRIPTION =
  'CBN Coop Seasonal Sales is a members-only seasonal sales platform for cooperative buying in Nigeria: ' +
  'members order food distribution, RAM (livestock) and exhibition stock online during each seasonal cycle ' +
  'and pick up at their branch.'

const EMAIL = 'customerservice@cbncoopng.com'
const PHONE_1 = '+2349096797982'
const PHONE_2 = '+2348180578550'

/** The cooperative behind the platform. */
export const organization = {
  '@type': 'Organization',
  '@id': `${SITE_URL}/#organization`,
  name: 'CBN Coop',
  alternateName: 'CBN Coop Seasonal Sales',
  url: `${SITE_URL}/`,
  logo: {
    '@type': 'ImageObject',
    url: `${SITE_URL}/logo.png`,
    width: 101,
    height: 100,
  },
  description: DESCRIPTION,
  email: EMAIL,
  telephone: PHONE_1,
  // Street address is intentionally omitted rather than guessed; addressCountry
  // keeps the PostalAddress valid. See README note in the handoff summary.
  address: {
    '@type': 'PostalAddress',
    addressCountry: 'NG',
  },
  contactPoint: [
    {
      '@type': 'ContactPoint',
      contactType: 'customer service',
      email: EMAIL,
      telephone: PHONE_1,
      availableLanguage: 'English',
      areaServed: 'NG',
    },
    {
      '@type': 'ContactPoint',
      contactType: 'customer service',
      telephone: PHONE_2,
      availableLanguage: 'English',
      areaServed: 'NG',
    },
  ],
}

/** The site itself. */
export const webSite = {
  '@type': 'WebSite',
  '@id': `${SITE_URL}/#website`,
  url: `${SITE_URL}/`,
  name: 'CBN Coop Seasonal Sales',
  inLanguage: 'en',
  description: DESCRIPTION,
  publisher: { '@id': `${SITE_URL}/#organization` },
}

/** The software product (the audit's "identity type" for product sites). */
export const softwareApplication = {
  '@type': 'SoftwareApplication',
  name: 'CBN Coop Seasonal Sales',
  url: `${SITE_URL}/`,
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web',
  inLanguage: 'en',
  description: DESCRIPTION,
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'NGN',
    description: 'Free for CBN Coop members',
  },
  publisher: { '@id': `${SITE_URL}/#organization` },
}

/** The full graph serialized into <script type="application/ld+json">. */
export const structuredData = {
  '@context': 'https://schema.org',
  '@graph': [organization, webSite, softwareApplication],
}
