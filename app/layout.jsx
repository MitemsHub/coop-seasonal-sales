// app/layout.jsx
import './globals.css'
import Navbar from './components/Navbar'
import BackToTop from './components/BackToTop'
import ExhibitionStatusToasts from './components/ExhibitionStatusToasts'
import FoodStatusToasts from './components/FoodStatusToasts'
import RamStatusToasts from './components/RamStatusToasts'
import { AuthProvider } from './contexts/AuthContext'
import { ThemeProvider } from './contexts/ThemeContext'
import ToastProvider from './components/ui/Toast'
import { Geist, Geist_Mono } from 'next/font/google'
import PageTransition from './components/PageTransition'
import ChatWidget from './components/ChatWidget'
import { siteMetadata } from '../lib/siteMetadata'
import { structuredData } from '../lib/schema'

const geist = Geist({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-geist-sans',
})

const geistMono = Geist_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-geist-mono',
})

// Head metadata lives in lib/siteMetadata.js (single source of truth, covered
// by unit tests): metadataBase, canonical resolution, og:type, brand title.
export const metadata = siteMetadata

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        {/* Apply saved/system theme before first paint to avoid a flash.
            The theme is stored per role: theme:admin | theme:rep | theme:member | theme:guest,
            with a fallback to the legacy single 'theme' key. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var u=null;try{u=JSON.parse(localStorage.getItem('user'))}catch(e){}
var r=(u&&(u.type==='admin'||u.type==='rep'||u.type==='member'))?u.type:'guest';
var t=localStorage.getItem('theme:'+r)||localStorage.getItem('theme');
if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}`,
          }}
        />
        {/* JSON-LD identity (Organization + WebSite + SoftwareApplication) —
            parsed by search/AI crawlers to verify who runs this site. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
      </head>
      <body className="min-h-screen bg-canvas text-fg antialiased">
        {/* ThemeProvider reads the signed-in role via useAuth, so it must live inside AuthProvider. */}
        <AuthProvider>
          <ThemeProvider>
            <ToastProvider>
              <Navbar />
              <BackToTop />
              <ExhibitionStatusToasts />
              <FoodStatusToasts />
              <RamStatusToasts />
              <main className="w-full">
                <PageTransition>{children}</PageTransition>
              </main>
              <ChatWidget />
            </ToastProvider>
          </ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
