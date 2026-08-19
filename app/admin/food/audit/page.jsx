'use client'

// app/admin/food/audit/page.jsx
// Admin audit log for food orders — posts, deliveries and rollbacks by reps
// and admins, read from the shared audit_log table. Thin wrapper over the
// shared StaffAuditLog component (the ram module uses the same component).
import StaffAuditLog from '../../components/StaffAuditLog'

const ACTIONS = [
  { value: 'post', label: 'Post' },
  { value: 'deliver', label: 'Deliver' },
  { value: 'rollback', label: 'Rollback' },
]

export default function AdminFoodAuditPage() {
  return (
    <StaffAuditLog
      module="food"
      apiPath="/api/admin/food/audit"
      subtitle="Who posted, delivered or rolled back each food order — across every branch."
      actions={ACTIONS}
      locationLabel="Branch"
    />
  )
}
