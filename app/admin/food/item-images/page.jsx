// app/admin/food/item-images/page.jsx
// The Image Bank moved to /admin/food/image-bank (the URL now matches the
// name). This stub keeps old links, bookmarks and the sidebar cache working.
import { redirect } from 'next/navigation'

export default function OldImageBankRedirect() {
  redirect('/admin/food/image-bank')
}
