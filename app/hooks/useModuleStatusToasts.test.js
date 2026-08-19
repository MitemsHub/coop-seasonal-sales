// app/hooks/useModuleStatusToasts.test.js
// Unit tests for the shared config-driven status-toast watcher:
//   1. First poll baselines silently (no toast for pre-existing statuses).
//   2. A real transition fires the module's toast and records the notification.
//   3. Food's `missingOrderMeansCancelled` treats a vanished order as cancelled.
//   4. Each module keeps its own snapshot key (storage isolation).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import useModuleStatusToasts from './useModuleStatusToasts'

const { toasts, record } = vi.hoisted(() => ({
  toasts: { success: vi.fn(), warning: vi.fn(), info: vi.fn() },
  record: vi.fn(),
}))

vi.mock('../components/ui/Toast', () => ({ useToast: () => toasts }))
vi.mock('@/lib/recordMemberNotification', () => ({ default: record }))

const okRes = (orders) => ({
  ok: true,
  json: async () => ({ ok: true, orders }),
})

const flush = async () => {
  for (let i = 0; i < 5; i++) await act(async () => {})
}

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
  toasts.success.mockClear()
  toasts.warning.mockClear()
  toasts.info.mockClear()
  record.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useModuleStatusToasts', () => {
  it('baselines silently on the first poll (no toast for existing statuses)', async () => {
    global.fetch = vi.fn().mockResolvedValue(okRes([{ id: 4, status: 'Pending' }]))
    const { unmount } = renderHook(() => useModuleStatusToasts('ram', 'A12345'))
    await flush()
    expect(toasts.success).not.toHaveBeenCalled()
    expect(toasts.warning).not.toHaveBeenCalled()
    expect(localStorage.getItem('ramStatus_A12345')).toBe(JSON.stringify({ 4: 'Pending' }))
    unmount()
  })

  it('fires the module toast and records the notification on a transition', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(okRes([{ id: 4, status: 'Pending' }]))
      .mockResolvedValueOnce(okRes([{ id: 4, status: 'Approved' }]))
    const { unmount } = renderHook(() => useModuleStatusToasts('ram', 'A12345'))
    await flush()
    expect(toasts.success).not.toHaveBeenCalled()
    await act(async () => {
      vi.advanceTimersByTime(5000)
    })
    await flush()
    expect(toasts.success).toHaveBeenCalledWith(
      'Your ram order #4 was approved. It is ready for collection at your delivery location.'
    )
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ module: 'ram', memberId: 'A12345', orderId: '4', event: 'approved', title: 'Order approved' })
    )
    expect(localStorage.getItem('ramStatus_A12345')).toBe(JSON.stringify({ 4: 'Approved' }))
    unmount()
  })

  it("food treats an order that vanishes from the view as cancelled", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(okRes([{ order_id: 7, status: 'Posted' }]))
      .mockResolvedValueOnce(okRes([]))
    const { unmount } = renderHook(() => useModuleStatusToasts('food', 'A12345'))
    await flush()
    expect(toasts.warning).not.toHaveBeenCalled()
    await act(async () => {
      vi.advanceTimersByTime(5000)
    })
    await flush()
    // The transition uses the status-specific copy (Posted → Cancelled).
    expect(toasts.warning).toHaveBeenCalledWith(
      'Your posted food order 7 was cancelled. Contact your branch rep if this was unexpected.'
    )
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ module: 'food', orderId: '7', event: 'cancelled' })
    )
    unmount()
  })

  it('keeps each module on its own snapshot key', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(okRes([{ id: 4, status: 'Pending' }])) // ram row
      .mockResolvedValueOnce(okRes([{ order_id: 9, status: 'Pending' }])) // food row
    const a = renderHook(() => useModuleStatusToasts('ram', 'A12345'))
    const b = renderHook(() => useModuleStatusToasts('food', 'A12345'))
    await flush()
    expect(localStorage.getItem('ramStatus_A12345')).toBe(JSON.stringify({ 4: 'Pending' }))
    expect(localStorage.getItem('foodStatus_A12345')).toBe(JSON.stringify({ 9: 'Pending' }))
    expect(localStorage.getItem('exhibitionStatus_A12345')).toBeNull()
    a.unmount()
    b.unmount()
  })
})
