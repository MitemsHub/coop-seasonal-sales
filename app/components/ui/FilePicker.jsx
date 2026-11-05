'use client'

// app/components/ui/FilePicker.jsx
// Styled replacement for a bare <input type="file">. The browser's native
// control renders as plain "Choose File / No file chosen" text, which reads as
// a label rather than something you can press. This gives every upload modal
// the same dashed drop zone, a visible Choose file action, drag & drop, and a
// card showing the selected file's name and size.
import { Upload } from 'lucide-react'
import { useRef, useState } from 'react'

export function fileSizeLabel(bytes) {
  const n = Number(bytes || 0)
  if (!Number.isFinite(n) || n <= 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export default function FilePicker({
  value = null,
  onChange,
  accept,
  disabled = false,
  hint = 'PDF, JPG, PNG, WEBP or HEIC · large photos are shrunk before upload',
  chooseLabel = 'Choose file',
}) {
  const inputRef = useRef(null)
  const [dragActive, setDragActive] = useState(false)

  const open = () => {
    if (disabled) return
    inputRef.current?.click()
  }

  const size = value ? fileSizeLabel(value.size) : ''

  return (
    <div
      role="button"
      tabIndex={0}
      aria-disabled={disabled}
      aria-label="Choose the invoice file to upload"
      onClick={open}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        open()
      }}
      onDragOver={(e) => {
        e.preventDefault()
        if (!disabled) setDragActive(true)
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragActive(false)
        if (disabled) return
        const dropped = e.dataTransfer?.files?.[0]
        if (dropped) onChange?.(dropped)
      }}
      className={[
        'rounded-lg border-2 border-dashed px-4 py-5 text-center transition-colors duration-200 ease-sakani',
        dragActive ? 'border-brand bg-brand-subtle' : 'border-line-strong bg-subtle/50 hover:border-brand',
        disabled
          ? 'cursor-not-allowed opacity-60'
          : 'cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
      ].join(' ')}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        disabled={disabled}
        onChange={(e) => {
          const picked = e.target.files?.[0]
          if (picked) onChange?.(picked)
          e.target.value = ''
        }}
      />
      {value ? (
        <div className="flex items-center justify-between gap-3 text-left">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-fg">{value.name}</div>
            <div className="text-xs text-muted">
              {size}
              {size ? ' · ' : ''}ready to upload
            </div>
          </div>
          <span className="shrink-0 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-semibold text-brand">
            Change
          </span>
        </div>
      ) : (
        <>
          <Upload className="mx-auto h-6 w-6 text-muted" strokeWidth={1.75} />
          <div className="mt-2 text-sm">
            <span className="font-semibold text-brand">{chooseLabel}</span>{' '}
            <span className="text-muted">or drag &amp; drop</span>
          </div>
          {hint ? <div className="mt-1 text-xs text-muted">{hint}</div> : null}
        </>
      )}
    </div>
  )
}
