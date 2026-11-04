import { redirect } from 'next/navigation'

// Reps cannot cancel or restore, so there is no cancelled queue for them.
export default function RepExhibitionCancelledPage() {
  redirect('/rep/exhibition/approved')
}
