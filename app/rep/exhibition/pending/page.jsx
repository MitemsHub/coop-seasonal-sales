import { redirect } from 'next/navigation'

// Reps no longer have a Pending queue: approval belongs to the admin.
export default function RepExhibitionPendingPage() {
  redirect('/rep/exhibition/approved')
}
