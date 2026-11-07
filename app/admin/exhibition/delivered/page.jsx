// The Delivered view no longer exists in the counter flow: the member confirms
// receipt after approval. Keep the old URL working for bookmarks and links.
import { redirect } from 'next/navigation'

export default function ExhibitionDeliveredRedirect() {
  redirect('/admin/exhibition/confirmed')
}
