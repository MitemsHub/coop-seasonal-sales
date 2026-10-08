// app/page.jsx — server entry for the landing route.
//
// The landing UI itself is a client component ('use client' pages cannot
// export metadata), so it lives in ./components/LandingPage and this server
// wrapper declares route-level metadata: the canonical URL the is-agentic
// audit checks on the homepage.

import LandingPage from './components/LandingPage'

export const metadata = {
  alternates: {
    canonical: '/',
  },
}

export default function Page() {
  return <LandingPage />
}
