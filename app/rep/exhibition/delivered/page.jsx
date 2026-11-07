import { redirect } from 'next/navigation'

// The counter flow ends with the member confirming receipt, so the rep's
// history view is Confirmed. Keep the old URL working for bookmarks.
export default function RepExhibitionDeliveredPage() {
  redirect('/rep/exhibition/confirmed')
}
