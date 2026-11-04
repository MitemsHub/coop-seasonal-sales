import { redirect } from 'next/navigation'

// Reps work the Approved queue; delivery history lives with the admin.
export default function RepExhibitionDeliveredPage() {
  redirect('/rep/exhibition/approved')
}
