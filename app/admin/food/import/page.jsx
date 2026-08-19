// app/admin/food/import/page.jsx
// The food Import page is retired — both of its sections moved to better homes:
//   • Members Import → Admin › Members Settings (used by every module)
//   • Items / Prices Import → Admin › Food Distribution › Data (just above
//     Item Image Management)
// Keep the old route alive so any saved bookmark or deep link lands on the
// Data page instead of a 404.
import { redirect } from 'next/navigation'

export default function FoodImportPage() {
  redirect('/admin/food/data-management')
}
