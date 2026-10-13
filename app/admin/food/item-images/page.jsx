'use client'

// app/admin/food/item-images/page.jsx
// Food Distribution · Items Management › Items Image Mang.
// The single image bank for every branch. Images uploaded here live on the
// `items` row (items.image_url → item-images bucket), so branches, the shop
// and the Items Import sections *link* to them instead of re-uploading the
// same photo every cycle. Moved here from the Data page.
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import ProtectedRoute from '../../../components/ProtectedRoute'
import ItemManagement from '../../../components/ItemManagement'
import Button from '../../../components/ui/Button'
import Select from '../../../components/ui/Select'
import Label from '../../../components/ui/Label'
import { Images, Link2 } from 'lucide-react'

function ItemImagesPageContent() {
  const router = useRouter()
  const [cycles, setCycles] = useState([])
  const [selectedCycleId, setSelectedCycleId] = useState(null)
  const [loadingCycles, setLoadingCycles] = useState(true)

  const loadCycles = useCallback(async () => {
    setLoadingCycles(true)
    try {
      const res = await fetch('/api/admin/cycles', { cache: 'no-store', credentials: 'same-origin' })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to load cycles')
      setCycles(json.cycles || [])
      setSelectedCycleId((prev) => {
        if (prev != null) return prev
        if (json.active_cycle_id != null) return json.active_cycle_id
        return (json.cycles || [])[0]?.id ?? null
      })
    } catch {
      // The bank still works without the cycle filter — ItemManagement
      // falls back to the full list when cycleId is null.
    } finally {
      setLoadingCycles(false)
    }
  }, [])

  useEffect(() => {
    loadCycles()
  }, [loadCycles])

  return (
    <div className="p-3 sm:p-6 max-w-7xl mx-auto">
      <div className="grid grid-cols-2 sm:flex sm:flex-row sm:items-center sm:justify-between mb-4 sm:mb-6 gap-2">
        <div className="col-span-1">
          <h1 className="text-h2 font-semibold tracking-tight text-fg">Admin · Items Image Mang.</h1>
          <p className="mt-1 text-body text-muted">
            The shared image bank. Upload each item&apos;s refined photo once — every branch, the shop and both
            Items Import sections link to these images instead of uploading them again.
          </p>
        </div>
        <Button variant="secondary" onClick={() => router.back()} className="justify-self-end col-span-1">
          ← Back
        </Button>
      </div>

      <div className="bg-surface rounded-xl shadow-lg border border-line-subtle p-4 mb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-h3 font-semibold text-fg mb-1 flex items-center gap-2">
              <Images className="h-4 w-4" strokeWidth={2} /> Item Image Management
            </h2>
            <p className="text-body text-muted">
              Pick a cycle to see the items priced in it — the images themselves are stored once per item and
              reused across every cycle and branch.
            </p>
          </div>
          <div className="sm:w-72">
            <Label htmlFor="image-cycle">Cycle filter</Label>
            <Select
              id="image-cycle"
              value={selectedCycleId ?? ''}
              onChange={(e) => setSelectedCycleId(e.target.value ? Number(e.target.value) : null)}
              disabled={loadingCycles || cycles.length === 0}
            >
              {cycles.length === 0 ? (
                <option value="">{loadingCycles ? 'Loading cycles…' : 'No cycles found — showing all items'}</option>
              ) : (
                cycles.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.code}){c.is_active ? ' · Active' : ''}
                  </option>
                ))
              )}
            </Select>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-info-border bg-info-bg px-3 py-2 text-caption text-info-fg">
          <Link2 className="h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
          Images chosen in <strong>Items Import</strong> (General / Outsourced Items) come from this bank — add a
          new one here whenever a refined photo is missing.
        </div>

        <div className="mt-4">
          <ItemManagement cycleId={selectedCycleId} cycles={cycles} />
        </div>
      </div>
    </div>
  )
}

export default function ItemImagesPage() {
  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <ItemImagesPageContent />
    </ProtectedRoute>
  )
}
