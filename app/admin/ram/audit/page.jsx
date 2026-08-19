'use client'

// app/admin/ram/audit/page.jsx
// Admin audit log for ram orders — approvals, cancellations, restores and
// deliveries by reps and admins, read from the shared audit_log table. Thin
// wrapper over the shared StaffAuditLog component (the food module uses the
// same component).
import StaffAuditLog from '../../components/StaffAuditLog'

const ACTIONS = [
  { value: 'approve', label: 'Approve' },
  { value: 'cancel', label: 'Cancel' },
  { value: 'restore', label: 'Restore' },
  { value: 'deliver', label: 'Deliver' },
]

export default function AdminRamAuditPage() {
  return (
    <StaffAuditLog
      module="ram"
      apiPath="/api/admin/ram/audit"
      subtitle="Who approved, cancelled, restored or delivered each ram order — across every hub."
      actions={ACTIONS}
      locationLabel="Hub"
    />
  )
}
