'use client'

// app/components/ui/ExportButton.jsx
// The app-wide uniform export button pair. Excel = accent pill + download icon,
// PDF = danger pill + file icon, both px-4 py-2 text-sm font-medium.
// Future pages get the style for free: <ExportButton format="excel" ... /> etc.
import Spinner from './Spinner'

const EXCEL_ICON = (
  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
  </svg>
)

const PDF_ICON = (
  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
  </svg>
)

export default function ExportButton({
  format = 'excel',
  onClick,
  disabled = false,
  busy = false,
  label,
  busyText = null,
  className = '',
}) {
  const isPdf = format === 'pdf'
  const text = label ?? (isPdf ? 'PDF' : 'Excel')
  const icon = isPdf ? PDF_ICON : EXCEL_ICON
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani disabled:opacity-50 ${
        isPdf ? 'bg-danger-fg hover:brightness-110' : 'bg-accent hover:bg-accent-hover'
      } ${className}`.trim()}
    >
      {busy ? <Spinner className="h-4 w-4" /> : icon}
      {busy && busyText ? busyText : text}
    </button>
  )
}

// Convenience pair — render both buttons side by side inside any flex container.
export function ExportButtons({
  onExcel,
  onPdf,
  excelDisabled,
  pdfDisabled,
  excelBusy,
  pdfBusy,
  excelBusyText,
  pdfBusyText,
}) {
  return (
    <>
      <ExportButton format="excel" onClick={onExcel} disabled={excelDisabled} busy={excelBusy} busyText={excelBusyText} />
      <ExportButton format="pdf" onClick={onPdf} disabled={pdfDisabled} busy={pdfBusy} busyText={pdfBusyText} />
    </>
  )
}
