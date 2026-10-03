'use client'

// app/survey/page.jsx
// Public food distribution item survey — the link reps receive (no login).
// Deliberately outside /rep so middleware never gates it; the API endpoints it
// calls (/api/food-survey/*, /api/branches/list) are public too.
// (The old /uploads route redirects here.)
import EntryHeader from '../components/EntryHeader'
import FoodSurveyForm from '../components/FoodSurveyForm'
import { ClipboardList } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default function FoodSurveyPage() {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <EntryHeader
        subtitle="Food Survey"
        backLabel="Back to site"
        backHref="/"
        links={[]}
      />

      <main className="relative flex-1 overflow-hidden p-4 sm:p-6">
        {/* Ambient tints — match the rep access / portal hero */}
        <div className="pointer-events-none absolute -left-24 -top-24 h-80 w-80 rounded-full bg-brand-500/10 blur-3xl" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-accent/10 blur-3xl" aria-hidden="true" />

        <div className="relative mx-auto w-full max-w-3xl">
          <div className="mb-6 text-center">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold uppercase tracking-wider text-brand">
              <ClipboardList className="h-3.5 w-3.5" strokeWidth={2.2} />
              Branch Price Survey
            </span>
            <h1 className="mt-4 text-h1 font-bold tracking-tight text-fg">
              Food Distribution Item Survey
            </h1>
            <p className="mt-2 text-sm text-muted sm:text-base">
              Tell us what&apos;s on your branch&apos;s shelves before the food cycle opens —
              for each item, enter the price and add a clear photo.
            </p>
          </div>

          <FoodSurveyForm variant="public" />

          <p className="mx-auto mt-6 max-w-xl text-center text-xs text-muted">
            Your progress is saved on this device, so you can leave and come back.
            Submitted entries appear in the admin portal immediately.
          </p>
        </div>
      </main>
    </div>
  )
}
