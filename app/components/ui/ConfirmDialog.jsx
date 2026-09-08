'use client'

// app/components/ui/ConfirmDialog.jsx
// Sakani-style confirmation dialog — drop-in replacement for window.confirm().
// Uses the existing Modal + Button components for consistent look & feel.
import Modal from './Modal'
import Button from './Button'

export default function ConfirmDialog({
  open = false,
  onClose,
  onConfirm,
  title = 'Are you sure?',
  message,
  confirmLabel = 'Confirm',
  variant = 'danger',
  loading = false,
}) {
  if (!open) return null

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={variant} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {message && (
        <p className="text-sm text-muted">{message}</p>
      )}
    </Modal>
  )
}
