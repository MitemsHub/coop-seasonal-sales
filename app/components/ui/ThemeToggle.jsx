'use client'

// app/components/ui/ThemeToggle.jsx
import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { useTheme } from '../../contexts/ThemeContext'

export default function ThemeToggle({ className = '' }) {
  const { theme, toggleTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const isDark = theme === 'dark'

  // Gate rendering until mounted to avoid SSR/client hydration mismatch
  // on the aria-label (theme is unknown during SSR).
  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return <span className={['inline-flex h-9 w-9 items-center justify-center', className].join(' ')} aria-hidden="true" />
  }
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className={[
        'inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted',
        'transition-colors duration-200 ease-sakani hover:bg-subtle hover:text-fg',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
        className,
      ].join(' ')}
    >
      <AnimatedIcon isDark={isDark} />
    </button>
  )
}

function AnimatedIcon({ isDark }) {
  return (
    <div className="relative h-5 w-5">
      <Sun
        className={`absolute inset-0 h-5 w-5 transition-all duration-300 ease-sakani ${
          isDark ? 'rotate-90 scale-0 opacity-0' : 'rotate-0 scale-100 opacity-100'
        }`}
        strokeWidth={2}
      />
      <Moon
        className={`absolute inset-0 h-5 w-5 transition-all duration-300 ease-sakani ${
          isDark ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-0 opacity-0'
        }`}
        strokeWidth={2}
      />
    </div>
  )
}
