import { redirect } from 'next/navigation'

// app/uploads/page.jsx
// Legacy route — the public food survey moved to /survey (every other survey
// surface carries the name). Keep this redirect so links reps already received
// keep working. Static photo files under /uploads/… are served from /public
// and are unaffected.
export const dynamic = 'force-dynamic'

export default function LegacyUploadsPage() {
  redirect('/survey')
}
