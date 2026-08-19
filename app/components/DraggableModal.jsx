'use client'
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import useFocusTrap from '../hooks/useFocusTrap'

export default function DraggableModal({
  open,
  onClose,
  title,
  children,
  footer,
  overlayClassName = 'bg-transparent',
  widthClass = 'max-w-md w-full mx-4'
}) {
  const dragging = useRef(false)
  const start = useRef({ x: 0, y: 0 })
  const panelRef = useRef(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })

  useEffect(() => {
    // Reset position whenever the modal opens
    if (open) setPos({ x: 0, y: 0 })
  }, [open])

  // Tab trap, focus in/restore, ESC close and scroll lock for the modal.
  useFocusTrap({ open, panelRef, breakpoint: null, lockScroll: true, onClose })

  const onPointerDown = (e) => {
    if (e?.target && e.target.closest) {
      const el = e.target
      if (el.closest('button, a, input, select, textarea, [role="button"]')) return
    }
    e.preventDefault()
    e.stopPropagation()
    try {
      e.currentTarget?.setPointerCapture?.(e.pointerId)
    } catch {}
    dragging.current = true
    start.current = { x: e.clientX - pos.x, y: e.clientY - pos.y }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }

  const onPointerMove = (e) => {
    if (!dragging.current) return
    setPos({ x: e.clientX - start.current.x, y: e.clientY - start.current.y })
  }

  const onPointerUp = () => {
    dragging.current = false
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
  }

  const stop = (e) => e.stopPropagation()

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className={`fixed inset-0 ${overlayClassName} flex items-start justify-center z-50 p-4 overflow-auto`}
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16, ease: 'easeOut' }}
        >
          <motion.div
            ref={panelRef}
            onClick={stop}
            style={{ x: pos.x, y: pos.y }}
            tabIndex={-1}
            initial={{ opacity: 0, scale: 0.985 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.985 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className={`bg-surface rounded-xl border border-line shadow-xl outline-none ${widthClass}`}
          >
            <div className="p-6">
              <div
                className="flex items-center justify-between mb-4 cursor-move select-none touch-none"
                onPointerDown={onPointerDown}
              >
                <h3 className="text-[15px] font-semibold text-fg">{title}</h3>
                <button
                  type="button"
                  aria-label="Close"
                  onClick={onClose}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-subtext transition-colors duration-200 ease-sakani hover:bg-subtle hover:text-fg"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              {children}
              {footer && <div className="mt-4">{footer}</div>}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
