// app/admin/food/import/page.jsx
// The food Import page is retired — its sections moved under
// Items Management › Items Import (repricer + Items/Prices Import) and the
// members import lives in Admin › Members Settings.
// Keep the old route alive so any saved bookmark or deep link lands on the
// Items Import page instead of a 404.
import { redirect } from 'next/navigation'

export default function FoodImportPage() {
  redirect('/admin/food/items-import')
}
