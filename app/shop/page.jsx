// app/shop/page.jsx
'use client'

import React, { useEffect, useMemo, useState, useCallback, Suspense } from 'react'
import Image from 'next/image'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  AlertTriangle,
  ArrowLeft,
  Banknote,
  CreditCard,
  Info,
  Landmark,
  MapPin,
  MessageCircle,
  Minus,
  Package,
  Plus,
  Search,
  ShoppingCart,
  User,
  Wallet,
} from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import { touchCart } from '@/lib/cartTouch'
import ProtectedRoute from '../components/ProtectedRoute'
import CartStickyBar from '../components/CartStickyBar'
import ContinueShoppingBanner from '../components/ContinueShoppingBanner'
import { useAuth } from '../contexts/AuthContext'
import useCartCount from '../hooks/useCartCount'
import { useToast } from '../components/ui/Toast'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'
import Input from '../components/ui/Input'
import Label from '../components/ui/Label'
import Select from '../components/ui/Select'
import Skeleton from '../components/ui/Skeleton'
import Spinner from '../components/ui/Spinner'
import ModuleClosedPanel from '../components/ModuleClosedPanel'

const naira = (v) => `₦${Number(v || 0).toLocaleString()}`

function MemberInfoGrid({ member, eligibility }) {
  const cells = [
    { label: 'Full Name', value: member.full_name },
    { label: 'Savings (Coop)', value: naira(member.savings) },
    { label: 'Loans (Coop)', value: naira(member.loans) },
    { label: 'Shopping Exposure', value: naira(eligibility.loanExposure) },
    { label: 'Outstanding Total', value: naira(eligibility.outstandingLoansTotal) },
    { label: 'Global Limit', value: naira(member.global_limit) },
  ]
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {cells.map((c) => (
        <div key={c.label} className="rounded-xl border border-line-subtle bg-subtle/60 p-2.5">
          <div className="text-chips font-medium text-muted">{c.label}</div>
          <div className="mt-0.5 text-xs font-semibold break-words text-fg sm:text-sm">{c.value}</div>
        </div>
      ))}
    </div>
  )
}

function MemberInfoSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-line-subtle bg-subtle/60 p-2.5">
          <Skeleton className="mb-1.5 h-2.5 w-2/3" />
          <Skeleton className="h-3.5 w-5/6" />
        </div>
      ))}
    </div>
  )
}

function ShopPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const isAdmin = searchParams.get('admin') === 'true'
  const { user } = useAuth()

  // Member + lookups
  const [memberId, setMemberId] = useState('')
  const { announceCart, onChange: onCartChange } = useCartCount('food', { memberId })
  const { announceCart: announceOrdersCount } = useCartCount('orders', { memberId })
  const toast = useToast()
  const [member, setMember] = useState(null)
  const [branches, setBranches] = useState([])
  const [departments, setDepartments] = useState([])

  // Branches: member (home/reporting) vs delivery (pricing/stock)
  const [memberBranchCode, setMemberBranchCode] = useState('')
  const [deliveryBranchCode, setDeliveryBranchCode] = useState('') // Remove default to show placeholder
  const [departmentName, setDepartmentName] = useState('') // Remove default to show placeholder

  // Items/cart
  const [items, setItems] = useState([])
  const [qty, setQty] = useState({})
  const [paymentOption, setPaymentOption] = useState('Loan')

  // Eligibility (exposure-aware)
  const [eligibility, setEligibility] = useState({
    savingsEligible: 0,
    loanEligible: 0,
    outstandingLoansTotal: 0,
    savingsExposure: 0,
    loanExposure: 0,
  })

  // UI state
  const [submitting, setSubmitting] = useState(false)
  const [goingToCart, setGoingToCart] = useState(false)
  const [cartSummaryOpen, setCartSummaryOpen] = useState(false)
  const [message, setMessage] = useState(null)
  const [loadingItems, setLoadingItems] = useState(new Set()) // Track items with pending API calls
  const [inputTimeouts, setInputTimeouts] = useState(new Map()) // Debounce input changes
  const [lookingUpMember, setLookingUpMember] = useState(false) // Track member lookup loading
  const [itemsBusy, setItemsBusy] = useState(false)
  const [ordersCount, setOrdersCount] = useState(null)
  const [shoppingOpen, setShoppingOpen] = useState(true)

  // Safe JSON helper
  const safeJson = async (res, label) => {
    const ct = res.headers.get('content-type') || ''
    if (ct.includes('application/json')) return await res.json()
    const text = await res.text()
    throw new Error(`Non-JSON response from ${label} (${res.status}): ${text.slice(0, 300)}`)
  }

  // Update member home branch
  const updateMemberBranch = async (newCode) => {
    try {
      if (!memberId) {
        setMessage({ type: 'error', text: 'Please select a member first' })
        return
      }
      const prev = memberBranchCode
      // Optimistic UI update for instant responsiveness
      setMemberBranchCode(newCode)
      // Persist locally for faster subsequent loads
      try { localStorage.setItem(`member_${memberId}`, JSON.stringify({ ...(member || {}), branches: { ...(member?.branches || {}), code: newCode } })) } catch {}

      const res = await fetch('/api/members/update-branch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId, branchCode: newCode })
      })
      const json = await safeJson(res, '/api/members/update-branch')
      if (!json.ok) throw new Error(json.error || 'Failed to update member branch')
      setMessage({ type: 'success', text: `Member branch updated to ${json.branch?.name || newCode}` })
    } catch (e) {
      // Revert on failure
      setMemberBranchCode(prev => prev)
      setMessage({ type: 'error', text: e.message })
    }
  }

  // Update member department
  const updateMemberDepartment = async (newName) => {
    try {
      if (!memberId) {
        setMessage({ type: 'error', text: 'Please select a member first' })
        return
      }
      const prev = departmentName
      // Optimistic UI update for instant responsiveness
      setDepartmentName(newName)
      // Persist locally for faster subsequent loads
      try { localStorage.setItem(`department_${memberId}`, newName) } catch {}

      const res = await fetch('/api/members/update-department', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId, departmentName: newName })
      })
      const json = await safeJson(res, '/api/members/update-department')
      if (!json.ok) throw new Error(json.error || 'Failed to update member department')
      setMessage({ type: 'success', text: `Member department updated to ${json.department?.name || newName}` })
    } catch (e) {
      // Revert on failure
      setDepartmentName(prev => prev)
      setMessage({ type: 'error', text: e.message })
    }
  }

  // Save cart data to localStorage whenever quantities change. The cart write
  // is skipped when the rebuilt lines already match the shared storage (a
  // change adopted from another surface or tab — echoing our rebuilt view back
  // would clobber the authoritative value). Only rebuild once the item catalog
  // is loaded — with an empty `items` list every `items.find()` misses and the
  // rebuild would collapse to [] right after adoption.
  useEffect(() => {
    if (!(memberId && items.length > 0 && Object.keys(qty).length > 0)) return
    const cartItems = Object.entries(qty)
      .filter(([sku, quantity]) => quantity > 0)
      .map(([sku, quantity]) => {
        const item = items.find(it => it.sku === sku)
        return item ? {
          sku,
          name: item.name,
          unit: item.unit,
          category: item.category,
          price: item.price,
          qty: quantity
        } : null
      })
      .filter(Boolean)

    try {
      const raw = localStorage.getItem(`cart_${memberId}`)
      const stored = raw ? JSON.parse(raw) : []
      if (Array.isArray(stored)) {
        const same =
          stored.length === cartItems.length &&
          cartItems.every(
            (l, i) =>
              stored[i]?.sku === l.sku &&
              Number(stored[i]?.qty) === Number(l.qty)
          )
        if (same) return
      }
    } catch {}

    localStorage.setItem(`cart_${memberId}`, JSON.stringify(cartItems))
    localStorage.setItem(`member_${memberId}`, JSON.stringify(member))
    localStorage.setItem(`deliveryBranch_${memberId}`, deliveryBranchCode)
    localStorage.setItem(`department_${memberId}`, departmentName)
    localStorage.setItem(`paymentOption_${memberId}`, paymentOption)
    touchCart('food', memberId)
  }, [qty, memberId, member, deliveryBranchCode, departmentName, paymentOption, items])

  // Instant Navbar badge sync — announce every cart change (incl. clearing the
  // last item) so the badge updates the same tick instead of at the next poll.
  useEffect(() => {
    if (!memberId) return
    const count = Object.values(qty).reduce((s, v) => s + Math.max(0, Number(v) || 0), 0)
    announceCart(count)
  }, [announceCart, memberId, qty])

  // Live sync — the hook delivers the stored cart on mount (mount-time
  // adoption) and on every external change (the /cart page, another tab).
  // Own-announce echoes are skipped by the hook, so this only runs when the
  // shared value genuinely changed; the functional-updater equality guard
  // keeps no-op adoptions from re-rendering.
  useEffect(() => {
    if (!memberId) return
    const syncCart = (value) => {
      const next = {}
      if (Array.isArray(value)) {
        for (const it of value) {
          const sku = String(it?.sku || '')
          const q = Math.max(0, Math.trunc(Number(it?.qty || 0)))
          if (sku && q > 0) next[sku] = q
        }
      }
      setQty((prev) => {
        const current = prev || {}
        const same =
          Object.keys(current).length === Object.keys(next).length &&
          Object.entries(next).every(([k, v]) => current[k] === v)
        return same ? prev : next
      })
    }
    return onCartChange(syncCart)
  }, [memberId, onCartChange])

  useEffect(() => {
    if (isAdmin) {
      const mid = searchParams?.get('mid')
      if (mid) setMemberId(String(mid).toUpperCase())
      return
    }
    if (user?.id) setMemberId(String(user.id).toUpperCase())
  }, [isAdmin, searchParams, user?.id])

  useEffect(() => {
    try {
      if (!memberId) return
      const v = localStorage.getItem(`ordersCount_${memberId}`)
      if (v != null && v !== '') setOrdersCount(Number(v))
    } catch {}
  }, [memberId])

  useEffect(() => {
    const mid = searchParams?.get('mid')
    if (mid && !isAdmin) router.replace('/shop')
  }, [isAdmin, router, searchParams])

  // Food shopping availability — when the module is closed, show the shared
  // closed panel instead of the shop UI (admins shopping on behalf are exempt).
  useEffect(() => {
    if (isAdmin) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/system/shopping', { cache: 'no-store' })
        const json = await res.json().catch(() => null)
        if (!cancelled && json) setShoppingOpen(!!json.open)
      } catch {
        // default to open when the availability check fails
      }
    })()
    return () => { cancelled = true }
  }, [isAdmin])

  useEffect(() => {
    if (!memberId) return
    const mid = searchParams?.get('mid')
    if (!isAdmin || mid) lookupMember()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId, isAdmin, searchParams])

  // Load branches/departments with simple session cache for snappy dropdowns
  useEffect(() => {
    let cancelled = false
    const cachedBranches = sessionStorage.getItem('branches_cache')
    const cachedDepartments = sessionStorage.getItem('departments_cache')
    if (cachedBranches) {
      try { const b = JSON.parse(cachedBranches); if (!cancelled) setBranches(b || []) } catch {}
    }
    if (cachedDepartments) {
      try { const d = JSON.parse(cachedDepartments); if (!cancelled) setDepartments(d || []) } catch {}
    }

    ;(async () => {
      const [{ data: b }, { data: d }] = await Promise.all([
        supabase.from('branches').select('code,name').order('name'),
        supabase.from('departments').select('name').order('name'),
      ])
      if (!cancelled) {
        setBranches(b || [])
        setDepartments(d || [])
      }
      try {
        sessionStorage.setItem('branches_cache', JSON.stringify(b || []))
        sessionStorage.setItem('departments_cache', JSON.stringify(d || []))
      } catch {}
      // Don't auto-load saved values on login - let member make fresh selections
    })()

    return () => { cancelled = true }
  }, [])

  // Load items for DELIVERY branch (cycle-scoped view)
  useEffect(() => {
    if (!deliveryBranchCode) {
      setItemsBusy(false)
      return
    }
    ;(async () => {
      setItemsBusy(true)
      try {
        const { data: br, error: brErr } = await supabase
          .from('branches')
          .select('id, code')
          .eq('code', deliveryBranchCode)
          .single()
        if (brErr || !br) { setItems([]); return }

        // Get active cycle
        const { data: activeCycle, error: cycleError } = await supabase
          .from('cycles')
          .select('id')
          .eq('is_active', true)
          .maybeSingle()
        if (cycleError) {
          setItems([])
          return
        }
        if (!activeCycle) {
          setItems([])
          return
        }

        // Get items with demand tracking data from inventory status view (fallback to branch_item_prices if view doesn't exist)
        // Filter out zero-price items
        let rows = null
        let error = null
        const runInventoryQuery = async (withCycle) => {
          let q = supabase
            .from('v_inventory_status')
            .select(`
              sku,
              item_id,
              item_name,
              unit,
              category,
              image_url,
              price,
              demand_tracking_mode,
              total_demand,
              pending_demand,
              confirmed_demand,
              delivered_demand
            `)
            .eq('branch_code', deliveryBranchCode)
            .gt('price', 0)
          if (withCycle) q = q.eq('cycle_id', activeCycle.id)
          return await q.order('item_name')
        }

        ;({ data: rows, error } = await runInventoryQuery(true))
        if (error && error.message && error.message.includes('cycle_id')) {
          ;({ data: rows, error } = await runInventoryQuery(false))
        }
        

        
        // Load per-branch markups to adjust displayed prices
        let markupByItemId = new Map()
        try {
          const runMarkupsQuery = async (withCycle) => {
            let q = supabase
              .from('branch_item_markups')
              .select('item_id, amount, active')
              .eq('branch_id', br.id)
            if (withCycle) q = q.eq('cycle_id', activeCycle.id)
            return await q
          }

          let markupsRes = await runMarkupsQuery(true)
          if (markupsRes.error && String(markupsRes.error.message || '').includes('cycle_id')) {
            markupsRes = await runMarkupsQuery(false)
          }
          const markups = markupsRes.data
          markupByItemId = new Map((markups || []).filter(m => m.active).map(m => [m.item_id, Number(m.amount || 0)]))
        } catch (mkErr) {
          console.warn('Markups fetch warn:', mkErr?.message)
        }

        // Fallback to original query if view doesn't exist
        if (error && error.message.includes('does not exist')) {
          let fallbackRows = null
          let fallbackError = null
          const runFallback = async (withCycle) => {
            let q = supabase
              .from('branch_item_prices')
              .select(`
                price,
                items:item_id(
                  item_id,
                  name, 
                  sku, 
                  unit, 
                  category,
                  image_url
                )
              `)
              .eq('branch_id', br.id)
              .gt('price', 0)
            if (withCycle) q = q.eq('cycle_id', activeCycle.id)
            return await q.order('name', { foreignTable: 'items' })
          }

          ;({ data: fallbackRows, error: fallbackError } = await runFallback(true))
          if (fallbackError && fallbackError.message && fallbackError.message.includes('cycle_id')) {
            ;({ data: fallbackRows, error: fallbackError } = await runFallback(false))
          }
          
          rows = fallbackRows
          error = fallbackError

        }
        

        
        if (error) {
  
          setItems([])
          return
        }
        
        // Process items for demand tracking mode (apply branch markups)
        const itemsWithDemand = (rows || []).map(row => {
          // Handle both v_inventory_status view format and fallback format
          if (row.item_name) {
            // v_inventory_status view format
            const base = Number(row.price || 0)
            const mk = markupByItemId.get(row.item_id) || 0
            return {
              sku: row.sku,
              name: row.item_name,
              unit: row.unit,
              category: row.category,
              price: base + mk,
              image_url: row.image_url,
              demand_tracking_mode: row.demand_tracking_mode,
              total_demand: row.total_demand || 0,
              pending_demand: row.pending_demand || 0,
              confirmed_demand: row.confirmed_demand || 0,
              delivered_demand: (row.delivered_demand ?? row.delivered_qty ?? 0)
            }
          } else {
            // Fallback branch_item_prices format - pure demand tracking
            const base = Number(row.price || 0)
            const mk = markupByItemId.get(row.items?.item_id) || 0
            return {
              sku: row.items.sku,
              name: row.items.name,
              unit: row.items.unit,
              category: row.items.category,
              price: base + mk,
              image_url: row.items.image_url,
              demand_tracking_mode: true, // Always use demand tracking
              total_demand: 0,
              pending_demand: 0,
              confirmed_demand: 0,
              delivered_demand: 0
            }
          }
        })

        setItems(itemsWithDemand)
        setQty({})
      } catch (e) {
        setItems([])
      } finally {
        setItemsBusy(false)
      }
    })()
  }, [deliveryBranchCode])

  // Load saved cart quantities from localStorage
  useEffect(() => {
    if (memberId && items.length > 0) {
      const savedCart = localStorage.getItem(`cart_${memberId}`)
      if (savedCart) {
        try {
          const cartItems = JSON.parse(savedCart)
          const savedQty = {}
          cartItems.forEach(item => {
            if (items.some(it => it.sku === item.sku)) {
              savedQty[item.sku] = item.qty
            }
          })
          setQty(savedQty)
        } catch (error) {
          console.error('Error loading saved cart:', error)
        }
      }
    }
  }, [memberId, items])

  // Load saved preferences from localStorage (only during session navigation, not on fresh login)
  useEffect(() => {
    if (memberId) {
      const savedPayment = localStorage.getItem(`paymentOption_${memberId}`)
      
      if (savedPayment) {
        setPaymentOption(savedPayment)
      }
      
      const navFlag = !!sessionStorage.getItem('navigatingFromCart')
      let hasSavedCart = false
      try {
        const raw = localStorage.getItem(`cart_${memberId}`)
        const parsed = raw ? JSON.parse(raw) : []
        hasSavedCart = Array.isArray(parsed) && parsed.length > 0
      } catch {}

      const isFromCart = document.referrer.includes('/cart') || navFlag || hasSavedCart

      if (isFromCart) {
        const savedDeliveryBranch = localStorage.getItem(`deliveryBranch_${memberId}`)
        const savedDepartment = localStorage.getItem(`department_${memberId}`)
        
        if (savedDeliveryBranch) {
          setDeliveryBranchCode(savedDeliveryBranch)
        }
        if (savedDepartment) {
          setDepartmentName(savedDepartment)
        }
      }
      
      // Clear the navigation flag
      sessionStorage.removeItem('navigatingFromCart')
    }
  }, [memberId])

  // Lookup member + eligibility
  const lookupMember = async () => {
    setMessage(null)
    if (!memberId) return

    setLookingUpMember(true)
    
    try {
      const normalizedMemberId = memberId.trim().toUpperCase()
      const { data, error } = await supabase
        .from('members')
        .select(`
          member_id,
          full_name,
          savings,
          loans,
          global_limit,
          category,
          branches:branch_id(code, name),
          departments:department_id(name)
        `)
        .eq('member_id', normalizedMemberId)
        .single()

      if (error || !data) {
        setMember(null)
        setEligibility({
          savingsEligible: 0,
          loanEligible: 0,
          outstandingLoansTotal: 0,
          savingsExposure: 0,
          loanExposure: 0,
        })
        setMessage({ type: 'error', text: 'Member not found. Please upload members or use a test member.' })
        return
      }

      setMember(data)
      if (data?.branches?.code) {
        setMemberBranchCode(data.branches.code)
        // Don't auto-set delivery branch - let member choose
      }
      // Don't auto-set department - let member choose

      try {
        const res = await fetch(`/api/members/eligibility?member_id=${encodeURIComponent(normalizedMemberId)}`)
        const json = await safeJson(res, '/api/members/eligibility')
        if (json.ok) setEligibility(json.eligibility)
      } catch (e) {
        console.warn('eligibility fetch failed:', e.message)
      }
    } catch (error) {
      console.error('Member lookup error:', error)
      setMessage({ type: 'error', text: 'Error looking up member. Please try again.' })
    } finally {
      setLookingUpMember(false)
    }
  }

  // Eligibility helpers
  const savingsEligible = Number(eligibility.savingsEligible || 0)
  const loanEligible = Number(eligibility.loanEligible || 0)
  const loanInterestRate = Number.isFinite(Number(eligibility.interest_rate)) ? Number(eligibility.interest_rate) : 0
  const loanInterestRatePct = Number.isFinite(Number(eligibility.interest_rate_pct))
    ? Number(eligibility.interest_rate_pct)
    : Math.round(loanInterestRate * 10000) / 100
  const includeInterestInLoanLimit = eligibility?.include_interest_in_cap !== false

  // Cart computations
  const cartLines = useMemo(() => {
    return items
      .filter(it => Number(qty[it.sku] || 0) > 0)
      .map(it => {
        const q = Number(qty[it.sku] || 0)
        return { sku: it.sku, name: it.name, price: it.price, qty: q, amount: q * it.price }
      })
  }, [items, qty])

  const cartTotal = useMemo(() => cartLines.reduce((s, l) => s + l.amount, 0), [cartLines])
  const cartUnits = useMemo(() => cartLines.reduce((s, l) => s + l.qty, 0), [cartLines])

  // Loan interest computation (rate applied to cart total when payment=Loan)
  const loanInterest = useMemo(() => (
    paymentOption === 'Loan' ? Math.round(cartTotal * loanInterestRate) : 0
  ), [paymentOption, cartTotal, loanInterestRate])
  const totalWithInterest = useMemo(() => (
    paymentOption === 'Loan' ? cartTotal + loanInterest : cartTotal
  ), [paymentOption, cartTotal, loanInterest])

  const currentLimit = paymentOption === 'Savings'
    ? savingsEligible
    : paymentOption === 'Loan'
    ? loanEligible
    : Number.POSITIVE_INFINITY

  // Remaining limit should respect selected payment option.
  // For Loan, factor interest into the remaining limit calculation;
  // For Savings, use principal cart total;
  // For Cash, there is no limit.
  const remainingLimit = useMemo(() => {
    if (paymentOption === 'Cash') return Number.POSITIVE_INFINITY
    if (paymentOption === 'Loan') {
      const used = includeInterestInLoanLimit ? totalWithInterest : cartTotal
      return Math.max(0, loanEligible - used)
    }
    // Savings
    return Math.max(0, savingsEligible - cartTotal)
  }, [paymentOption, loanEligible, savingsEligible, cartTotal, totalWithInterest, includeInterestInLoanLimit])

  const overLimit = paymentOption !== 'Cash' && (
    paymentOption === 'Loan'
      ? (includeInterestInLoanLimit ? totalWithInterest : cartTotal) > currentLimit
      : cartTotal > currentLimit
  )
  const canSubmit = !!member && !!deliveryBranchCode && !!departmentName && cartLines.length > 0 && !overLimit && !submitting

  const setQtySafe = useCallback(async (sku, val) => {
    const newQty = Math.max(0, Math.min(9999, Number(val) || 0))
    const currentQty = qty[sku] || 0
    const adjustment = newQty - currentQty
    
    // If no change, return early
    if (adjustment === 0) {
      return
    }
    
    // Find the item to get current stock info
    const item = items.find(it => it.sku === sku)
    if (!item) {
      return
    }

    if (adjustment > 0 && paymentOption !== 'Cash') {
      const price = Number(item.price || 0)
      const currentCartTotal = items.reduce((s, it) => s + (Number(qty[it.sku] || 0) * Number(it.price || 0)), 0)
      const nextCartTotal = currentCartTotal + adjustment * price
      if (paymentOption === 'Savings' && nextCartTotal > savingsEligible) {
        setMessage({ type: 'error', text: 'This quantity exceeds your Savings eligibility.' })
        return
      }
      if (paymentOption === 'Loan') {
        const nextInterest = Math.round(nextCartTotal * loanInterestRate)
        const nextTotal = nextCartTotal + nextInterest
        const used = includeInterestInLoanLimit ? nextTotal : nextCartTotal
        if (used > loanEligible) {
          setMessage({
            type: 'error',
            text: includeInterestInLoanLimit
              ? `This quantity exceeds your Loan eligibility (including ${loanInterestRatePct}% interest).`
              : 'This quantity exceeds your Loan eligibility (interest excluded from the limit).',
          })
          return
        }
      }
    }
    
    // Check if member and delivery branch are set
    if (!member?.member_id) {
      setMessage({ type: 'error', text: 'Please select a member first' })
      return
    }
    
    if (!deliveryBranchCode) {
      setMessage({ type: 'error', text: 'Please select a delivery branch first' })
      return
    }
    
    // Demand tracking mode - no stock limits, allow unlimited ordering
    
    // OPTIMISTIC UPDATE: Update UI immediately for instant feedback
    const previousQty = currentQty
    setQty(prev => ({ ...prev, [sku]: newQty }))
    
    // Add loading state for this item
    setLoadingItems(prev => new Set([...prev, sku]))
    
    // Clear any previous error messages
    if (message?.type === 'error') {
      setMessage(null)
    }
    
    // Handle API call asynchronously
    try {
      const action = adjustment > 0 ? 'reserve' : 'release'
      const response = await fetch('/api/inventory/adjust-stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sku,
          branchCode: deliveryBranchCode,
          adjustment: Math.abs(adjustment),
          memberId: member.member_id,
          action
        })
      })
      
      const result = await response.json()
      
      if (!response.ok || !result.ok) {
        // ROLLBACK: Revert optimistic update on API failure
        setQty(prev => ({ ...prev, [sku]: previousQty }))
        setMessage({ type: 'error', text: result.error || 'Stock adjustment failed' })
        return
      }

      // Brief confirmation when an item is first added to the cart (0 → N).
      // Increments and removals are already visible in the sticky bar/badge,
      // so only a genuine add needs the explicit acknowledgement.
      if (adjustment > 0 && currentQty === 0) {
        toast.success(`${item.name} added to your cart`, { duration: 2200 })
      }
      
      // Note: We don't update local stock here as the API already accounts for the adjustment
      // The optimistic update in qty state is sufficient for UI responsiveness
      // Real stock will be refreshed on page reload or through other mechanisms
      
    } catch (error) {
      // ROLLBACK: Revert optimistic update on network error
      setQty(prev => ({ ...prev, [sku]: previousQty }))
      setMessage({ type: 'error', text: 'Failed to update stock. Please try again.' })
    } finally {
      // Remove loading state for this item
      setLoadingItems(prev => {
        const newSet = new Set(prev)
        newSet.delete(sku)
        return newSet
      })
    }
  }, [items, loanEligible, loanInterestRate, loanInterestRatePct, member, deliveryBranchCode, paymentOption, qty, savingsEligible, toast])

  // Debounced input handler for better performance
  const handleInputChange = useCallback((sku, value) => {
    // Clear existing timeout for this item
    const currentTimeout = inputTimeouts.get(sku)
    if (currentTimeout) {
      clearTimeout(currentTimeout)
    }
    
    // Update local state immediately for responsive UI
    const newQty = Math.max(0, Math.min(9999, Number(value) || 0))
    setQty(prev => ({ ...prev, [sku]: newQty }))
    
    // Debounce API call by 300ms
    const timeoutId = setTimeout(() => {
      setQtySafe(sku, newQty)
      setInputTimeouts(prev => {
        const newMap = new Map(prev)
        newMap.delete(sku)
        return newMap
      })
    }, 300)
    
    setInputTimeouts(prev => {
      const newMap = new Map(prev)
      newMap.set(sku, timeoutId)
      return newMap
    })
  }, [setQtySafe, inputTimeouts])

const itemCards = useMemo(() => (
  items.map((it) => {
    const currentQty = qty[it.sku] || 0
    const isLoading = loadingItems.has(it.sku)
    const canDecrease = currentQty > 0 && !isLoading
    const canIncrease = (it.demand_tracking_mode || false) && !isLoading

    return (
      <div key={it.sku} className="group flex flex-col rounded-2xl border border-line bg-surface p-2.5 transition-all duration-200 ease-sakani hover:-translate-y-0.5 hover:border-line-strong hover:shadow-md">
        <div className="relative mb-2 flex h-24 w-full items-center justify-center overflow-hidden rounded-xl bg-subtle sm:h-28">
          <Image
            src={it.image_url || '/images/items/placeholder.svg'}
            alt={it.name}
            fill
            sizes="(max-width: 640px) 45vw, (max-width: 1024px) 30vw, 15vw"
            className="object-contain transition-transform duration-500 ease-sakani group-hover:scale-[1.06]"
            loading="lazy"
            onError={(e) => {
              e.currentTarget.src = '/images/items/placeholder.svg'
            }}
          />
        </div>
        <div className="text-xs font-semibold leading-snug break-words text-fg sm:text-sm">{it.name}</div>
        <div className="mb-2 mt-0.5 text-chips text-muted sm:text-xs">{it.unit} • {it.category}</div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <div className="text-sm font-bold text-brand tabular-nums sm:text-base">₦{it.price.toLocaleString()}</div>
          <Badge tone={it.demand_tracking_mode ? 'success' : 'neutral'} variant="subtle">
            {it.demand_tracking_mode ? `Demand: ${it.total_demand || 0}` : 'No stock data'}
          </Badge>
        </div>
        <div className="mt-auto flex items-center justify-center gap-2 rounded-lg bg-subtle/60 px-2 py-1.5">
          <button
            type="button"
            aria-label={`Decrease ${it.name}`}
            onClick={() => setQtySafe(it.sku, currentQty - 1)}
            disabled={!canDecrease}
            className={[
              'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors duration-150',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
              canDecrease ? 'bg-subtle text-fg hover:bg-line-subtle' : 'bg-subtle text-subtext',
            ].join(' ')}
          >
            <Minus className="h-3.5 w-3.5" strokeWidth={2.5} />
          </button>
          <div className="flex h-7 w-12 items-center justify-center rounded-md border border-line-subtle bg-surface text-center text-xs font-semibold tabular-nums text-fg">
            {isLoading ? <Spinner size={13} className="text-muted" /> : currentQty}
          </div>
          <button
            type="button"
            aria-label={`Increase ${it.name}`}
            onClick={() => setQtySafe(it.sku, currentQty + 1)}
            disabled={!canIncrease}
            className={[
              'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors duration-150',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
              canIncrease ? 'bg-brand-subtle text-brand hover:bg-brand/20' : 'bg-brand-subtle text-brand/40',
            ].join(' ')}
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
          </button>
        </div>
      </div>
    )
  })
), [items, qty, loadingItems, setQtySafe])

  const submitOrder = async () => {
    setSubmitting(true)
    setMessage(null)
    
    // Store current cart for potential rollback
    const currentCart = { ...qty }
    
    try {
      // Convert reserved stock to purchased stock for each item
      const purchasePromises = cartLines.map(async (line) => {
        try {
          const response = await fetch('/api/inventory/adjust-stock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sku: line.sku,
              branchCode: deliveryBranchCode,
              adjustment: line.qty,
              memberId: member.member_id,
              action: 'purchase'
            })
          })
          
          const result = await response.json()
          if (!response.ok || !result.ok) {
            throw new Error(`Failed to process purchase for ${line.sku}: ${result.error}`)
          }
          
          return result
        } catch (error) {
          console.error(`Purchase processing failed for ${line.sku}:`, error)
          throw error
        }
      })
      
      // Wait for all stock purchases to complete
      await Promise.all(purchasePromises)
      
      // Submit the order
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memberId: member.member_id,
          deliveryBranchCode,          // delivery drives pricing/stock
          departmentName,
          paymentOption,
          lines: cartLines.map(l => ({ sku: l.sku, qty: l.qty })),
        }),
      })

      const json = await safeJson(res, '/api/orders')
      if (!res.ok || !json.ok) {
        throw new Error(json?.error || `Request failed (${res.status})`)
      }

      // Refresh eligibility to reflect the new order's impact on loan balance
      try {
        const eRes = await fetch(`/api/members/eligibility?member_id=${encodeURIComponent(member.member_id)}`)
        const eJson = await safeJson(eRes, '/api/members/eligibility (post-submit)')
        if (eJson.ok) setEligibility(eJson.eligibility)
      } catch (e) {
        console.warn('Failed to refresh eligibility after order submission:', e)
      }

      // Clear cart and redirect on success
      setMessage({ type: 'success', text: `Order submitted! ID: ${json.order_id}. Status: Pending.` })
      setQty({})

      setOrdersCount(prev => {
        const next = (Number.isFinite(Number(prev)) ? Number(prev) : 0) + 1
        try {
          if (member?.member_id) {
            localStorage.setItem(`ordersCount_${member.member_id}`, String(next))
            announceOrdersCount(next)
          }
        } catch {}
        return next
      })
      
      // Clear saved cart from localStorage
      if (member?.member_id) {
        localStorage.removeItem(`cart_${member.member_id}`)
        localStorage.removeItem(`deliveryBranch_${member.member_id}`)
        localStorage.removeItem(`department_${member.member_id}`)
      }
      
      router.push(
        isAdmin
          ? `/shop/success/${json.order_id}?mid=${encodeURIComponent(member.member_id)}`
          : `/shop/success/${json.order_id}`
      )
      
    } catch (e) {
      console.error('submitOrder error:', e)
      setMessage({ type: 'error', text: e.message })
      
      // Rollback: Release any reserved stock if order submission failed
      try {
        const rollbackPromises = cartLines.map(async (line) => {
          await fetch('/api/inventory/adjust-stock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sku: line.sku,
              branchCode: deliveryBranchCode,
              adjustment: line.qty,
              memberId: member.member_id,
              action: 'release'
            })
          })
        })
        
        await Promise.all(rollbackPromises)
      } catch (rollbackError) {
        // Rollback failed - this should be logged in production
      }
      
    } finally {
      setSubmitting(false)
    }
  }

  // When the food module is closed, show the shared closed panel instead of the
  // shop UI (admins shopping on behalf of a member stay in the shop).
  if (!shoppingOpen && !isAdmin) {
    return (
      <ProtectedRoute allowedRoles={['member']}>
        <div className="min-h-screen bg-canvas">
          <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
            <div className="absolute -top-32 -left-24 h-80 w-80 rounded-full bg-brand/10 blur-3xl" />
            <div className="absolute top-1/3 -right-24 h-96 w-96 rounded-full bg-accent/10 blur-3xl" />
          </div>
          <ModuleClosedPanel
            module="food"
            variant="inline"
            onViewOrders={() => router.push('/orders')}
            onBack={() => router.push('/my-coop')}
          />
        </div>
      </ProtectedRoute>
    )
  }

  return (
    <ProtectedRoute allowedRoles={['member']}>
      <div className="min-h-screen bg-canvas">
        {/* Ambient canvas glows (Sakani) */}
        <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
          <div className="absolute -top-32 -left-24 h-80 w-80 rounded-full bg-brand/10 blur-3xl" />
          <div className="absolute top-1/3 -right-24 h-96 w-96 rounded-full bg-accent/10 blur-3xl" />
        </div>
        <div className="relative p-fluid pb-24 sm:pb-28 md:pb-32 max-w-7xl mx-auto">
          {/* Continue-shopping banner — surfaces ram/exhibition carts here;
              the food cart is already covered by the sticky cart bar. */}
          <ContinueShoppingBanner excludeModules={['food']} className="mb-fluid-lg" />

          <div className="mb-fluid-lg flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-1.5 rounded-full bg-brand-subtle px-fluid-xs py-fluid-2xs text-chips font-semibold uppercase tracking-wide text-brand-fg">
                <ShoppingCart className="h-3.5 w-3.5" strokeWidth={2.2} />
                Cooperative Store
              </div>
              <h1 className="mt-1.5 font-display text-[1.0625rem] font-semibold tracking-tight text-fg sm:text-h1">
                {isAdmin
                  ? 'Member Shopping'
                  : member?.full_name
                    ? `Welcome, ${member.full_name.split(' ')[0]}`
                    : 'Welcome to the Shop'}
              </h1>
              <p className="mt-1 max-w-xl text-sm text-muted">
                {isAdmin
                  ? 'Shopping on behalf of a member'
                  : 'Order fresh from the cooperative store. Pay with savings, loan, or cash.'}
              </p>
            </div>
            {isAdmin && (
              <Button variant="secondary" size="sm" leftIcon={ArrowLeft} onClick={() => router.push('/admin/food/cart')}>
                Back to Admin
              </Button>
            )}
          </div>

          {isAdmin && (
            <Card className="mb-3">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-subtle text-brand">
                  <User className="h-4 w-4" strokeWidth={2} />
                </span>
                <div>
                  <h2 className="text-sm font-semibold text-fg">Member Lookup</h2>
                  <p className="text-xs text-muted">Find a member to shop on their behalf</p>
                </div>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <Label htmlFor="shop-member-id">Member ID</Label>
                  <Input
                    id="shop-member-id"
                    type="text"
                    value={memberId}
                    onChange={(e) => setMemberId(e.target.value.toUpperCase())}
                    disabled={lookingUpMember}
                    placeholder="e.g. A12345"
                    className="w-full"
                  />
                </div>
                <div className="flex items-end">
                  <Button
                    className="w-full"
                    loading={lookingUpMember}
                    leftIcon={Search}
                    onClick={lookupMember}
                    disabled={!memberId.trim()}
                  >
                    Lookup
                  </Button>
                </div>
              </div>
              {lookingUpMember ? (
                <div className="mt-3 border-t border-line-subtle pt-3">
                  <MemberInfoSkeleton />
                </div>
              ) : member ? (
                <div className="mt-3 border-t border-line-subtle pt-3">
                  <MemberInfoGrid member={member} eligibility={eligibility} />
                </div>
              ) : null}
            </Card>
          )}

          {!isAdmin && (
            <Card className="mb-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-subtle text-brand">
                    <User className="h-4 w-4" strokeWidth={2} />
                  </span>
                  <div>
                    <h2 className="text-sm font-semibold text-fg">Member Information</h2>
                    <p className="text-xs text-muted">Your cooperative account at a glance</p>
                  </div>
                </div>
                {lookingUpMember && <Spinner size={16} className="text-muted" />}
              </div>
              <div className="mt-3">
                {member ? (
                  <MemberInfoGrid member={member} eligibility={eligibility} />
                ) : (
                  <MemberInfoSkeleton />
                )}
              </div>
            </Card>
          )}
            <div className="mb-3 grid gap-3 lg:grid-cols-2">
              <Card>
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-subtle text-brand">
                    <MapPin className="h-4 w-4" strokeWidth={2} />
                  </span>
                  <h2 className="text-sm font-semibold text-fg">Branch & Department</h2>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="member-branch">Member Branch</Label>
                    <Select
                      id="member-branch"
                      value={memberBranchCode || ''}
                      onChange={(e) => updateMemberBranch(e.target.value)}
                      className="w-full"
                    >
                      <option value="">Select member branch</option>
                      {branches.map((b) => (
                        <option key={b.code} value={b.code}>{b.name}</option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="delivery-branch">Delivery Location</Label>
                    <Select
                      id="delivery-branch"
                      value={deliveryBranchCode}
                      onChange={(e) => {
                        const v = e.target.value
                        setDeliveryBranchCode(v)
                        try { if (memberId) localStorage.setItem(`deliveryBranch_${memberId}`, v || '') } catch {}
                      }}
                      className="w-full"
                    >
                      <option value="">Select delivery branch</option>
                      {branches.map((b) => (
                        <option key={b.code} value={b.code}>{b.name}</option>
                      ))}
                    </Select>
                  </div>
                  <div className="sm:col-span-2">
                    <Label htmlFor="department">Department</Label>
                    <Select
                      id="department"
                      value={departmentName}
                      onChange={(e) => updateMemberDepartment(e.target.value)}
                      className="w-full"
                    >
                      <option value="">Select department</option>
                      {departments.map((d) => (
                        <option key={d.name} value={d.name}>{d.name}</option>
                      ))}
                    </Select>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="flex items-center gap-2 rounded-lg border border-line-subtle bg-subtle/50 px-3 py-2">
                    <Banknote className="h-4 w-4 shrink-0 text-muted" strokeWidth={2} />
                    <div className="min-w-0">
                      <div className="text-chips font-medium text-muted">Savings Limit</div>
                      <div className="text-xs font-semibold tabular-nums text-fg sm:text-sm">₦{savingsEligible.toLocaleString()}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 rounded-lg border border-line-subtle bg-subtle/50 px-3 py-2">
                    <Wallet className="h-4 w-4 shrink-0 text-muted" strokeWidth={2} />
                    <div className="min-w-0">
                      <div className="text-chips font-medium text-muted">Loan Limit</div>
                      <div className="text-xs font-semibold tabular-nums text-fg sm:text-sm">₦{loanEligible.toLocaleString()}</div>
                    </div>
                  </div>
                </div>
              </Card>

              <Card>
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-subtle text-brand">
                    <CreditCard className="h-4 w-4" strokeWidth={2} />
                  </span>
                  <h2 className="text-sm font-semibold text-fg">Payment</h2>
                </div>
                <Label htmlFor="payment-option">Payment Method</Label>
                <div
                  id="payment-option"
                  role="radiogroup"
                  aria-label="Payment method"
                  className="grid grid-cols-3 gap-1 rounded-xl bg-subtle p-1"
                >
                  {[
                    {
                      key: 'Savings',
                      icon: Banknote,
                      disabled: savingsEligible <= 0,
                      title: savingsEligible <= 0 ? 'Savings unavailable (insufficient balance)' : 'Pay from your savings balance',
                    },
                    { key: 'Loan', icon: Wallet, disabled: false, title: 'Pay on loan (interest applies)' },
                    { key: 'Cash', icon: CreditCard, disabled: false, title: 'Pay in cash on delivery' },
                  ].map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      role="radio"
                      aria-checked={paymentOption === opt.key}
                      disabled={opt.disabled}
                      title={opt.title}
                      onClick={() => setPaymentOption(opt.key)}
                      className={[
                        'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition-all duration-200 ease-sakani',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
                        paymentOption === opt.key
                          ? 'bg-brand text-on-accent shadow-xs'
                          : opt.disabled
                            ? 'cursor-not-allowed text-muted opacity-50'
                            : 'text-muted hover:bg-surface hover:text-fg',
                      ].join(' ')}
                    >
                      <opt.icon className="h-4 w-4" strokeWidth={2} />
                      {opt.key}
                    </button>
                  ))}
                </div>

                {paymentOption === 'Savings' && savingsEligible > 0 && (
                  <div className="mt-3 rounded-lg border border-success-border bg-success-bg/60 p-3">
                    <div className="flex items-start gap-2">
                      <Banknote className="mt-0.5 h-4 w-4 shrink-0 text-success-fg" strokeWidth={2} />
                      <div>
                        <div className="text-xs font-semibold text-success-fg">Savings Payment</div>
                        <div className="mt-0.5 text-xs text-muted">
                          Members can only use 50% of their total savings balance for purchases. Your current available savings limit is ₦{savingsEligible.toLocaleString()}.
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {paymentOption === 'Loan' && (
                  <div className="mt-3 rounded-lg border border-warning-border bg-warning-bg/60 p-3">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-fg" strokeWidth={2} />
                      <div>
                        <div className="text-xs font-semibold text-warning-fg">Loan Payment</div>
                        <div className="mt-0.5 text-xs text-muted">
                          Interest Rate: {loanInterestRatePct}% interest will be charged on all items purchased using the loan payment option.
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {paymentOption === 'Cash' && (
                  <div className="mt-3 rounded-lg border border-info-border bg-info-bg/60 p-3">
                    <div className="flex items-start gap-2">
                      <Info className="mt-0.5 h-4 w-4 shrink-0 text-info-fg" strokeWidth={2} />
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-info-fg">Cash Payment</div>
                        <div className="mt-0.5 text-xs text-muted">
                          After placing your order, kindly send your payment receipt to the Cooperative (09061388502) for verification.
                        </div>
                        <div className="mt-2 rounded-lg border border-info-border bg-surface p-2.5">
                          <div className="flex items-center gap-2 text-xs font-semibold text-fg">
                            <Landmark className="h-4 w-4 text-info-fg" strokeWidth={2} />
                            Bank Transfer Details
                          </div>
                          <div className="mt-1 space-y-0.5 text-xs text-muted">
                            <div>Fidelity Bank</div>
                            <div>Account Number: 5080056982</div>
                            <div>Account Name: CBN Staff Multipurpose Coop. Soc. Ltd.</div>
                          </div>
                        </div>
                        <a
                          href="https://wa.me/+2349061388502"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-2 inline-flex items-center gap-2 rounded-lg bg-success-fg px-3 py-2 text-xs font-medium text-on-accent transition-[filter] duration-200 hover:brightness-110"
                        >
                          <MessageCircle className="h-4 w-4" strokeWidth={2} />
                          Send Receipt via WhatsApp
                        </a>
                      </div>
                    </div>
                  </div>
                )}
              </Card>
            </div>
            <Card className="mb-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-subtle text-brand">
                    <Package className="h-4 w-4" strokeWidth={2} />
                  </span>
                  <div>
                    <h2 className="text-sm font-semibold text-fg">Available Items</h2>
                    <p className="text-xs text-muted">
                      {deliveryBranchCode ? `Priced for delivery to ${deliveryBranchCode}` : 'Select a delivery branch to view items'}
                    </p>
                  </div>
                </div>
                {deliveryBranchCode && !itemsBusy && items.length > 0 && (
                  <Badge tone="brand" variant="subtle">{items.length} item{items.length === 1 ? '' : 's'}</Badge>
                )}
              </div>

              {!deliveryBranchCode ? (
                <EmptyState
                  icon={MapPin}
                  title="Select a delivery branch"
                  description="Choose your delivery location above to see the items available for your order."
                />
              ) : itemsBusy ? (
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7">
                  {Array.from({ length: 14 }).map((_, i) => (
                    <div key={i} className="rounded-xl border border-line bg-surface p-2.5">
                      <Skeleton rounded="lg" className="mb-2 h-24 w-full sm:h-28" />
                      <Skeleton className="mb-2 h-3 w-5/6" />
                      <Skeleton className="mb-3 h-3 w-2/3" />
                      <div className="flex items-center justify-between gap-2">
                        <Skeleton className="h-4 w-1/2" />
                        <Skeleton className="h-4 w-1/3" />
                      </div>
                      <Skeleton rounded="lg" className="mt-3 h-8 w-full" />
                    </div>
                  ))}
                </div>
              ) : items.length === 0 ? (
                <EmptyState
                  icon={Package}
                  title="No items available"
                  description="No items are configured for this branch yet. Please check back later."
                />
              ) : (
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7">
                  {itemCards}
                </div>
              )}
            </Card>
            {/* Sticky cart bar — shared component so every shopping surface stays in sync */}
            <CartStickyBar
              variant="summary"
              lines={cartLines}
              units={cartUnits}
              total={cartTotal}
              loanInterest={loanInterest}
              loanInterestRatePct={loanInterestRatePct}
              totalWithInterest={totalWithInterest}
              overLimit={overLimit}
              remainingLimit={remainingLimit}
              paymentOption={paymentOption}
              summaryOpen={cartSummaryOpen}
              onToggleSummary={() => setCartSummaryOpen((v) => !v)}
              goingToCart={goingToCart}
              onGoToCart={async () => {
                setGoingToCart(true)
                router.push(isAdmin ? `/cart?member_id=${memberId}&admin=true` : '/cart')
              }}
              message={message}
            />
          </div>
        </div>
    </ProtectedRoute>
  )
}
export default function ShopPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <ShopPageContent />
    </Suspense>
  )
}
