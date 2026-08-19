// app/cart/page.jsx
'use client'

import { useEffect, useMemo, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  AlertTriangle,
  ArrowLeft,
  Banknote,
  Check,
  CreditCard,
  Info,
  MapPin,
  Minus,
  Package,
  Plus,
  Receipt,
  ShoppingCart,
  Trash2,
  Wallet,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import useCartCount from '../hooks/useCartCount'
import ProtectedRoute from '../components/ProtectedRoute'
import { supabase } from '@/lib/supabaseClient'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import EmptyState from '../components/ui/EmptyState'
import Label from '../components/ui/Label'
import Select from '../components/ui/Select'
import Spinner from '../components/ui/Spinner'

function CartPageContent() {
  const [member, setMember] = useState(null)
  const [branches, setBranches] = useState([])
  const [departments, setDepartments] = useState([])
  const [items, setItems] = useState([])
  const [cartItems, setCartItems] = useState([])
  const [paymentOption, setPaymentOption] = useState('Savings')
  const [deliveryBranch, setDeliveryBranch] = useState('')
  const [department, setDepartment] = useState('')
  const [message, setMessage] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [itemsBusy, setItemsBusy] = useState(false)
  const [shoppingOpen, setShoppingOpen] = useState(true)
  const [shoppingStatusLoading, setShoppingStatusLoading] = useState(false)
  const [eligibility, setEligibility] = useState({
    savingsEligible: 0,
    loanEligible: 0,
    outstandingLoansTotal: 0,
    savingsExposure: 0,
    loanExposure: 0,
  })
  
  const router = useRouter()
  const searchParams = useSearchParams()
  const isAdmin = searchParams.get('admin') === 'true'
  const { user, loading: authLoading } = useAuth()
  const memberId = isAdmin ? (searchParams.get('member_id') || '') : (user?.id || '')
  const { announceCart: announceCartEvent, onChange: onCartChange } = useCartCount('food', { memberId })

  const emitToast = (type, text) => {
    try {
      window.dispatchEvent(new CustomEvent('app-toast', { detail: { type, text } }))
    } catch {}
  }

  const persistDeliveryBranch = (code) => {
    try {
      if (memberId) localStorage.setItem(`deliveryBranch_${memberId}`, code || '')
    } catch {}
  }

  const persistDepartment = (name) => {
    try {
      if (memberId) localStorage.setItem(`department_${memberId}`, name || '')
    } catch {}
  }

  const persistPaymentOption = (opt) => {
    try {
      if (memberId) localStorage.setItem(`paymentOption_${memberId}`, opt || '')
    } catch {}
  }

  // Helper function for safe JSON parsing
  // Do not throw on non-2xx; return parsed payload so callers can show
  // meaningful error messages instead of a generic network failure.
  const safeJson = async (res, endpoint) => {
    const ct = res.headers.get('content-type') || ''
    if (ct.includes('application/json')) {
      try {
        return await res.json()
      } catch (e) {
        // Fall back to text if JSON parsing fails
      }
    }
    const text = await res.text().catch(() => '')
    return { ok: res.ok, error: text ? `${endpoint} (${res.status}): ${text.slice(0, 300)}` : `${endpoint} (${res.status})` }
  }

  useEffect(() => {
    let cancelled = false
    const loadStatus = async () => {
      try {
        setShoppingStatusLoading(true)
        const res = await fetch('/api/system/shopping', { cache: 'no-store' })
        const json = await safeJson(res, '/api/system/shopping')
        if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to load shopping status')
        if (!cancelled) setShoppingOpen(!!json.open)
      } catch {
        if (!cancelled) setShoppingOpen(false)
      } finally {
        if (!cancelled) setShoppingStatusLoading(false)
      }
    }
    if (!isAdmin) loadStatus()
    return () => { cancelled = true }
  }, [isAdmin])

  // Load member eligibility
  const loadEligibility = async (memberIdToLoad) => {
    try {
      const res = await fetch(`/api/members/eligibility?member_id=${encodeURIComponent(memberIdToLoad)}`)
      const json = await safeJson(res, '/api/members/eligibility')
      if (json.ok) {
        setEligibility(json.eligibility)
      }
    } catch (e) {
      console.warn('eligibility fetch failed:', e.message)
    }
  }

  // Lookup member from database
  const lookupMember = async (memberIdToLookup) => {
    if (!memberIdToLookup) return null

    const normalizedMemberId = memberIdToLookup.trim().toUpperCase()
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
      console.warn('Member not found:', normalizedMemberId)
      return null
    }

    return data
  }

  // Load member data and cart from localStorage
  useEffect(() => {
    const loadData = async () => {
      // The ProtectedRoute gate above mounts this page only after AuthContext
      // has restored the stored member session, so a direct/cold link to
      // /cart no longer races the null-user first render (which used to bounce
      // it straight to /shop).
      if (authLoading) return
      if (!isAdmin) {
        const legacy = searchParams.get('member_id')
        if (legacy) router.replace('/cart')
      }
      if (!memberId) {
        // Defensive only — the gate already routed unauthenticated users home.
        router.replace('/')
        return
      }
      
      // Load cart data from localStorage
      const savedCart = localStorage.getItem(`cart_${memberId}`)
      const savedMember = localStorage.getItem(`member_${memberId}`)
      const savedDeliveryBranch = localStorage.getItem(`deliveryBranch_${memberId}`)
      const savedDepartment = localStorage.getItem(`department_${memberId}`)
      const savedPayment = localStorage.getItem(`paymentOption_${memberId}`)
      
      if (savedCart) {
        setCartItems(JSON.parse(savedCart))
      }
      
      let memberData = null
      if (savedMember) {
        memberData = JSON.parse(savedMember)
        setMember(memberData)
      } else {
        // If no member data in localStorage, fetch from database
        memberData = await lookupMember(memberId)
        if (memberData) {
          setMember(memberData)
          // Save to localStorage for future use
          localStorage.setItem(`member_${memberId}`, JSON.stringify(memberData))
          // Set default delivery branch and department from member data
          if (memberData?.branches?.code && !savedDeliveryBranch) {
            setDeliveryBranch(memberData.branches.code)
            localStorage.setItem(`deliveryBranch_${memberId}`, memberData.branches.code)
          }
          if (memberData?.departments?.name && !savedDepartment) {
            setDepartment(memberData.departments.name)
            localStorage.setItem(`department_${memberId}`, memberData.departments.name)
          }
        }
      }
      
      // Load eligibility data if we have member data
      if (memberData) {
        loadEligibility(memberId)
      }
      
      // Load branches and departments first, then set saved values
      await Promise.all([loadBranches(), loadDepartments()])
      
      // Set saved values after departments are loaded
      if (savedDeliveryBranch) {
        setDeliveryBranch(savedDeliveryBranch)
      }
      if (savedDepartment) {
        setDepartment(savedDepartment)
      }
      if (savedPayment) {
        setPaymentOption(savedPayment)
      }
      
      setLoading(false)
    }
    
    loadData()
  }, [isAdmin, memberId, router, searchParams, authLoading])

  // Cross-tab freshness — the hook delivers the stored cart on mount and on
  // every external change (the shop, another tab), skipping our own persist
  // echoes. The equality guard keeps no-op adoptions from re-rendering.
  useEffect(() => {
    if (!memberId) return
    const syncCartItems = (value) => {
      const next = Array.isArray(value) ? value : []
      setCartItems((prev) => {
        const same =
          prev.length === next.length &&
          next.every(
            (l, i) =>
              prev[i]?.sku === l.sku &&
              Number(prev[i]?.qty) === Number(l.qty) &&
              Number(prev[i]?.price) === Number(l.price)
          )
        return same ? prev : next
      })
    }
    return onCartChange(syncCartItems)
  }, [memberId, onCartChange])

  // Load items when delivery branch changes
  useEffect(() => {
    if (deliveryBranch) {
      loadItems()
    }
  }, [deliveryBranch])

  const loadBranches = async () => {
    try {
      const res = await fetch('/api/branches/list')
      const data = await res.json()
      if (data.ok) {
        setBranches(data.branches || [])
      }
    } catch (error) {
      console.error('Error loading branches:', error)
    }
  }

  const loadDepartments = async () => {
    try {
      const res = await fetch('/api/departments/list')
      const data = await res.json()
      if (data.ok) {
        setDepartments(data.departments || [])
      }
    } catch (error) {
      console.error('Error loading departments:', error)
    }
  }

  const loadItems = async () => {
    if (!deliveryBranch) return
    try {
      setItemsBusy(true)
      const res = await fetch(`/api/items/prices?branch=${encodeURIComponent(deliveryBranch)}`, {
        headers: { 'Accept': 'application/json' },
      })
      const data = await safeJson(res, '/api/items/prices')
      if (data.ok) {
        setItems(data.items || [])
      }
    } catch (error) {
      console.error('Error loading items:', error)
    } finally {
      setItemsBusy(false)
    }
  }

  const updateQuantity = (sku, newQty) => {
    const item = cartItems.find((i) => i.sku === sku)
    if (!item) return

    const nextQty = Math.max(0, Math.min(9999, Number(newQty) || 0))
    const othersTotal = cartItems.reduce((sum, i) => sum + i.price * (i.sku === sku ? 0 : i.qty), 0)
    const nextCartTotal = othersTotal + item.price * nextQty

    if (paymentOption === 'Savings') {
      const limit = Number(eligibility.savingsEligible || 0)
      if (limit > 0 && nextCartTotal > limit) {
        setMessage({ type: 'error', text: 'This change would exceed your Savings limit. Reduce quantities or switch payment method.' })
        emitToast('error', 'This change would exceed your Savings limit.')
        return
      }
    }

    if (paymentOption === 'Loan') {
      const limit = Number(eligibility.loanEligible || 0)
      const withInterest = nextCartTotal + Math.round(nextCartTotal * loanInterestRate)
      const used = includeInterestInLoanLimit ? withInterest : nextCartTotal
      if (limit > 0 && used > limit) {
        setMessage({
          type: 'error',
          text: includeInterestInLoanLimit
            ? `This change would exceed your Loan limit (including ${loanInterestRatePct}% interest). Reduce quantities or switch payment method.`
            : 'This change would exceed your Loan limit (interest excluded from the limit). Reduce quantities or switch payment method.',
        })
        emitToast('error', includeInterestInLoanLimit ? 'This change would exceed your Loan limit (including interest).' : 'This change would exceed your Loan limit.')
        return
      }
    }

    const updatedCart = cartItems
      .map((i) => (i.sku === sku ? { ...i, qty: nextQty } : i))
      .filter((i) => i.qty > 0)

    setCartItems(updatedCart)
    localStorage.setItem(`cart_${memberId}`, JSON.stringify(updatedCart))
    announceCart(updatedCart)
  }

  const removeItem = (sku) => {
    const updatedCart = cartItems.filter(item => item.sku !== sku)
    setCartItems(updatedCart)
    localStorage.setItem(`cart_${memberId}`, JSON.stringify(updatedCart))
    announceCart(updatedCart)
  }

  const addNewItem = () => {
    // Find items not already in cart
    const availableItems = items.filter(item => 
      !cartItems.some(cartItem => cartItem.sku === item.sku)
    )
    
    if (availableItems.length === 0) {
      setMessage({ type: 'error', text: 'All available items are already in your cart' })
      return
    }
    
    // Add first available item with qty 1
    const newItem = {
      sku: availableItems[0].sku,
      name: availableItems[0].name,
      unit: availableItems[0].unit,
      category: availableItems[0].category,
      price: availableItems[0].price,
      qty: 1
    }
    
    const updatedCart = [...cartItems, newItem]
    setCartItems(updatedCart)
    localStorage.setItem(`cart_${memberId}`, JSON.stringify(updatedCart))
    announceCart(updatedCart)
  }

  const updateItemSku = (oldSku, newSku) => {
    const selectedItem = items.find(item => item.sku === newSku)
    if (!selectedItem) return
    
    const updatedCart = cartItems.map(item => 
      item.sku === oldSku ? {
        ...selectedItem,
        qty: item.qty
      } : item
    )
    
    setCartItems(updatedCart)
    localStorage.setItem(`cart_${memberId}`, JSON.stringify(updatedCart))
    announceCart(updatedCart)
  }

  const cartTotal = cartItems.reduce((sum, item) => sum + (item.price * item.qty), 0)
  const savingsEligible = Number(eligibility.savingsEligible || 0)
  const loanEligible = Number(eligibility.loanEligible || 0)

  // Announce every cart mutation so the Navbar badge (and the shop's sticky
  // bar) update the same tick instead of waiting for the poll.
  const announceCart = (next) => {
    const count = (Array.isArray(next) ? next : cartItems).reduce(
      (s, it) => s + Math.max(0, Number(it?.qty || 0)),
      0
    )
    announceCartEvent(count)
  }
  const loanInterestRate = Number.isFinite(Number(eligibility.interest_rate)) ? Number(eligibility.interest_rate) : 0
  const loanInterestRatePct = Number.isFinite(Number(eligibility.interest_rate_pct))
    ? Number(eligibility.interest_rate_pct)
    : Math.round(loanInterestRate * 10000) / 100
  const includeInterestInLoanLimit = eligibility?.include_interest_in_cap !== false
  
  // Loan interest calculation (rate applied to cart total when payment=Loan)
  const loanInterest = paymentOption === 'Loan' ? Math.round(cartTotal * loanInterestRate) : 0
  const totalWithInterest = paymentOption === 'Loan' ? cartTotal + loanInterest : cartTotal
  
  const currentLimit = paymentOption === 'Savings' ? savingsEligible : 
                      paymentOption === 'Loan' ? loanEligible : Infinity
  const overLimit = paymentOption !== 'Cash' && (
    paymentOption === 'Loan'
      ? (includeInterestInLoanLimit ? totalWithInterest : cartTotal) > currentLimit
      : cartTotal > currentLimit
  )
  const canSubmit = cartItems.length > 0 && !overLimit && deliveryBranch && department

  const submitDisabledReason = useMemo(() => {
    if (submitting) return null
    if (cartItems.length === 0) return 'Add at least one item to your cart.'
    if (!deliveryBranch) return 'Select a delivery branch to continue.'
    if (!department) return 'Select your department to continue.'
    if (overLimit) return `Total exceeds your ${paymentOption} limit. Reduce quantities or switch payment method.`
    return null
  }, [cartItems.length, department, deliveryBranch, overLimit, paymentOption, submitting])

  const submitOrder = async () => {
    if (!canSubmit) return
    
    setSubmitting(true)
    setMessage(null)
    
    try {
      const orderData = {
        memberId: memberId,
        deliveryBranchCode: deliveryBranch,
        departmentName: department,
        paymentOption: paymentOption,
        lines: cartItems.map(item => ({
          sku: item.sku,
          qty: item.qty,
          unit_price: item.price
        }))
      }
      
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(orderData)
      })
      
      const data = await safeJson(res, '/api/orders')
      
      if (data.ok) {
        // Clear cart from localStorage
        localStorage.removeItem(`cart_${memberId}`)
        localStorage.removeItem(`deliveryBranch_${memberId}`)
        localStorage.removeItem(`department_${memberId}`)
        announceCart([])
        
        // Redirect to success page
        router.push(isAdmin ? `/shop/success/${data.order_id}?mid=${memberId}` : `/shop/success/${data.order_id}`)
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to submit order' })
      }
    } catch (error) {
      // Show the actual error to aid troubleshooting
      setMessage({ type: 'error', text: error?.message || 'Network error. Please try again.' })
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
        <div className="text-center">
          <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-subtle shadow-xs">
            <Spinner size={20} className="text-brand" />
          </div>
          <p className="text-sm text-muted">Loading your cart…</p>
        </div>
      </div>
    )
  }

  if (!member) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
        <div className="w-full max-w-sm text-center">
          <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-subtle">
            <ShoppingCart className="h-6 w-6 text-brand" strokeWidth={1.8} />
          </div>
          <h2 className="text-base font-semibold text-fg">Member data not found</h2>
          <p className="mt-1 text-sm text-muted">We couldn&apos;t find your member record. Head back to the shop to sign in again.</p>
          <Button
            className="mt-4"
            leftIcon={ArrowLeft}
            disabled={!shoppingOpen || shoppingStatusLoading}
            onClick={() => {
              sessionStorage.setItem('navigatingFromCart', 'true')
              router.push('/shop')
            }}
          >
            {shoppingOpen ? 'Back to Shop' : 'Shopping Closed'}
          </Button>
        </div>
      </div>
    )
  }

  const paymentOptions = [
    {
      key: 'Savings',
      icon: Banknote,
      disabled: savingsEligible <= 0,
      title: savingsEligible <= 0 ? 'Savings unavailable (insufficient balance)' : 'Pay from your savings balance',
    },
    { key: 'Loan', icon: Wallet, disabled: false, title: 'Pay on loan (interest applies)' },
    { key: 'Cash', icon: CreditCard, disabled: false, title: 'Pay in cash on delivery' },
  ]

  return (
    <div className="min-h-screen bg-canvas">
        {/* Ambient canvas glows (Sakani) */}
        <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
          <div className="absolute -top-32 -left-24 h-80 w-80 rounded-full bg-brand/10 blur-3xl" />
          <div className="absolute top-1/3 -right-24 h-96 w-96 rounded-full bg-accent/10 blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-6xl p-fluid pb-24 sm:pb-28 md:pb-32">
          {/* Hero */}
          <div className="mb-fluid-lg flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-1.5 rounded-full bg-brand-subtle px-fluid-xs py-fluid-2xs text-chips font-semibold uppercase tracking-wide text-brand-fg">
                <ShoppingCart className="h-3.5 w-3.5" strokeWidth={2.2} />
                {isAdmin ? 'Member Checkout' : 'Your Cart'}
              </div>
              <h1 className="mt-1.5 font-display text-[1.0625rem] font-semibold tracking-tight text-fg sm:text-h1">
                {isAdmin ? 'Member Shopping Cart' : 'Shopping Cart'}
              </h1>
              <p className="mt-1 text-sm text-muted">
                {isAdmin ? 'Managing cart for member' : 'Review and edit your items before checkout'}
              </p>
            </div>
            {isAdmin && (
              <div className="flex shrink-0 items-start">
                <Button variant="secondary" size="sm" leftIcon={ArrowLeft} onClick={() => router.push('/admin/food/cart')}>
                  Back to Admin
                </Button>
              </div>
            )}
          </div>

          {/* Delivery Details & Payment Method */}
          <div className="ui-card mb-fluid-lg p-fluid-md sm:p-fluid-lg">
            <div className="grid grid-cols-1 gap-fluid-lg md:grid-cols-2">
              {/* Delivery Details */}
              <div>
                <div className="mb-3 flex items-center gap-2">
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-subtle text-brand">
                    <MapPin className="h-4 w-4" strokeWidth={2} />
                  </span>
                  <h3 className="text-sm font-semibold text-fg">Delivery Details</h3>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="cart-delivery-branch">Delivery Branch</Label>
                    <Select
                      id="cart-delivery-branch"
                      value={deliveryBranch}
                      onChange={(e) => {
                        const v = e.target.value
                        setDeliveryBranch(v)
                        persistDeliveryBranch(v)
                      }}
                      className="w-full"
                    >
                      <option value="">Select branch</option>
                      {branches.map((branch, index) => (
                        <option key={`branch-${branch.branch_id || index}`} value={branch.code}>
                          {branch.name} ({branch.code})
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="cart-department">Department</Label>
                    <Select
                      id="cart-department"
                      value={department}
                      onChange={(e) => {
                        const v = e.target.value
                        setDepartment(v)
                        persistDepartment(v)
                      }}
                      className="w-full"
                    >
                      <option value="">Select department</option>
                      {departments.map((dept, index) => (
                        <option key={`dept-${dept || index}`} value={dept}>{dept}</option>
                      ))}
                    </Select>
                  </div>
                </div>
              </div>

              {/* Payment Method */}
              <div>
                <div className="mb-3 flex items-center gap-2">
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent-subtle text-accent-hover">
                    <CreditCard className="h-4 w-4" strokeWidth={2} />
                  </span>
                  <h3 className="text-sm font-semibold text-fg">Payment</h3>
                </div>
                <Label htmlFor="cart-payment">Payment Method</Label>
                <div
                  id="cart-payment"
                  role="radiogroup"
                  aria-label="Payment method"
                  className="grid grid-cols-3 gap-1 rounded-xl bg-subtle p-1"
                >
                  {paymentOptions.map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      role="radio"
                      aria-checked={paymentOption === opt.key}
                      disabled={opt.disabled}
                      title={opt.title}
                      onClick={() => {
                        setPaymentOption(opt.key)
                        persistPaymentOption(opt.key)
                      }}
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

                {/* Quick Summary */}
                <div className="mt-3 space-y-1.5 rounded-xl border border-line-subtle bg-subtle/60 p-3">
                  <div className="flex justify-between text-xs text-muted">
                    <span>Items</span>
                    <span className="font-semibold text-fg">{cartItems.length}</span>
                  </div>
                  <div className="flex justify-between text-xs text-muted">
                    <span>Total</span>
                    <span className="font-semibold text-fg">₦{cartTotal.toLocaleString()}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-fluid-md lg:grid-cols-3">
            {/* Cart Items */}
            <div className="lg:col-span-2">
              <div className="ui-card p-fluid-md">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-subtle text-brand">
                      <Package className="h-4 w-4" strokeWidth={2} />
                    </span>
                    <h2 className="text-sm font-semibold text-fg">Cart Items</h2>
                    <Badge tone="brand" variant="subtle">
                      {cartItems.length} {cartItems.length === 1 ? 'item' : 'items'}
                    </Badge>
                    {itemsBusy && <Spinner size={14} className="text-muted" />}
                  </div>
                  <Button size="sm" leftIcon={Plus} onClick={addNewItem} disabled={itemsBusy || items.length === 0}>
                    Add Item
                  </Button>
                </div>

                {cartItems.length === 0 ? (
                  <EmptyState
                    icon={ShoppingCart}
                    title="Your cart is empty"
                    description="Add items from the shop to get started."
                  >
                    <Button
                      leftIcon={ShoppingCart}
                      onClick={() => {
                        sessionStorage.setItem('navigatingFromCart', 'true')
                        router.push(isAdmin ? `/shop?mid=${memberId}&admin=true` : '/shop')
                      }}
                    >
                      Start Shopping
                    </Button>
                  </EmptyState>
                ) : (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {cartItems.map((item) => (
                      <div
                        key={item.sku}
                        className="flex flex-col rounded-2xl border border-line bg-surface p-3 transition-all duration-200 ease-sakani hover:border-line-strong hover:shadow-md"
                      >
                        <div className="mb-2">
                          <Select
                            value={item.sku}
                            onChange={(e) => updateItemSku(item.sku, e.target.value)}
                            disabled={itemsBusy || items.length === 0}
                            className="w-full"
                          >
                            {itemsBusy ? (
                              <option value={item.sku}>Loading items…</option>
                            ) : items.length === 0 ? (
                              <option value={item.sku}>{item.name} - ₦{item.price.toLocaleString()}</option>
                            ) : (
                              items.map(availableItem => (
                                <option key={availableItem.sku} value={availableItem.sku}>
                                  {availableItem.name} - ₦{availableItem.price.toLocaleString()}
                                </option>
                              ))
                            )}
                          </Select>
                          <div className="mt-1 text-chips text-muted">
                            {item.unit} • {item.category}
                          </div>
                        </div>

                        {/* Unit Price */}
                        <div className="mb-2 flex items-center justify-between rounded-lg bg-info-bg px-2.5 py-1.5">
                          <span className="text-chips font-medium text-info-fg">Unit Price</span>
                          <span className="text-sm font-bold tabular-nums text-info-fg">₦{item.price.toLocaleString()}</span>
                        </div>

                        {/* Quantity Controls */}
                        <div className="mb-2 flex items-center justify-center">
                          <div className="flex items-center overflow-hidden rounded-lg border border-line bg-surface">
                            <button
                              onClick={() => updateQuantity(item.sku, item.qty - 1)}
                              aria-label={`Decrease ${item.name || 'item'}`}
                              className="inline-flex h-9 w-9 items-center justify-center bg-subtle text-fg transition-colors duration-150 hover:bg-danger-bg hover:text-danger-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                            >
                              <Minus className="h-3.5 w-3.5" strokeWidth={2.5} />
                            </button>
                            <div className="w-12 text-center text-sm font-bold tabular-nums text-fg sm:w-14">
                              {Number(item.qty || 0)}
                            </div>
                            <button
                              onClick={() => updateQuantity(item.sku, item.qty + 1)}
                              aria-label={`Increase ${item.name || 'item'}`}
                              className="inline-flex h-9 w-9 items-center justify-center bg-subtle text-fg transition-colors duration-150 hover:bg-success-bg hover:text-success-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                            >
                              <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
                            </button>
                          </div>
                        </div>

                        {/* Line Total */}
                        <div className="mb-3 flex items-center justify-between rounded-lg bg-success-bg px-2.5 py-1.5">
                          <span className="text-chips font-medium text-success-fg">Line Total</span>
                          <span className="text-sm font-bold tabular-nums text-success-fg">₦{(item.price * item.qty).toLocaleString()}</span>
                        </div>

                        {/* Remove */}
                        <Button
                          variant="danger"
                          size="sm"
                          className="mt-auto w-full"
                          leftIcon={Trash2}
                          onClick={() => removeItem(item.sku)}
                        >
                          Remove Item
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Order Summary & Checkout */}
            <div className="space-y-3">
              <div className="ui-card p-fluid-md lg:sticky lg:top-16">
                <div className="mb-3 flex items-center gap-2">
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent-subtle text-accent-hover">
                    <Receipt className="h-4 w-4" strokeWidth={2} />
                  </span>
                  <h3 className="text-sm font-semibold text-fg">Order Summary</h3>
                </div>

                <div className={['grid gap-2.5', paymentOption === 'Loan' ? 'grid-cols-2' : 'grid-cols-3'].join(' ')}>
                  <div className="rounded-xl border border-line-subtle bg-subtle/60 px-2 py-2.5 text-center">
                    <div className="text-sm font-bold tabular-nums text-fg sm:text-base">{cartItems.length}</div>
                    <div className="text-chips font-medium text-muted">Items in Cart</div>
                  </div>
                  <div className="rounded-xl border border-line-subtle bg-subtle/60 px-2 py-2.5 text-center">
                    <div className="text-sm font-bold tabular-nums text-fg sm:text-base">₦{cartTotal.toLocaleString()}</div>
                    <div className="text-chips font-medium text-muted">Cart Total</div>
                  </div>
                  {paymentOption === 'Loan' && (
                    <div className="rounded-xl border border-warning-border bg-warning-bg/60 px-2 py-2.5 text-center">
                      <div className="text-sm font-bold tabular-nums text-warning-fg sm:text-base">₦{loanInterest.toLocaleString()}</div>
                      <div className="text-chips font-medium text-warning-fg">Interest ({loanInterestRatePct}%)</div>
                    </div>
                  )}
                  <div className="rounded-xl border border-brand/20 bg-brand-subtle/60 px-2 py-2.5 text-center">
                    <div className="text-sm font-bold tabular-nums text-brand-fg sm:text-base">
                      {currentLimit === Number.POSITIVE_INFINITY ? '∞' : `₦${currentLimit.toLocaleString()}`}
                    </div>
                    <div className="text-chips font-medium text-brand-fg">Limit ({paymentOption})</div>
                  </div>
                </div>

                {paymentOption === 'Loan' && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg border border-warning-border bg-warning-bg/60 p-3">
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-warning-fg" strokeWidth={2} />
                    <div className="min-w-0">
                      <h4 className="text-xs font-semibold text-warning-fg">Loan Payment Information</h4>
                      <p className="mt-0.5 text-xs text-warning-fg">
                        <strong>Total with Interest:</strong> ₦{totalWithInterest.toLocaleString()} ({loanInterestRatePct}% interest applied)
                      </p>
                      <p className="mt-1 text-xs text-warning-fg">
                        {includeInterestInLoanLimit
                          ? 'Your loan limit applies to the total amount including interest.'
                          : 'Your loan limit applies to principal only (interest is excluded from the limit).'}
                      </p>
                    </div>
                  </div>
                )}

                {overLimit && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg border border-danger-border bg-danger-bg/60 p-3">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger-fg" strokeWidth={2} />
                    <p className="text-xs font-medium text-danger-fg">
                      Total exceeds {paymentOption} limit. Please reduce quantities or switch payment method.
                    </p>
                  </div>
                )}

                {message && (
                  <div className={[
                    'mt-3 rounded-lg border p-3 text-xs font-medium',
                    message.type === 'success'
                      ? 'border-success-border bg-success-bg/60 text-success-fg'
                      : 'border-danger-border bg-danger-bg/60 text-danger-fg',
                  ].join(' ')}>
                    {message.text}
                  </div>
                )}

                {!!submitDisabledReason && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg border border-warning-border bg-warning-bg/60 p-3">
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-warning-fg" strokeWidth={2} />
                    <p className="text-xs font-medium text-warning-fg">{submitDisabledReason}</p>
                  </div>
                )}

                <Button
                  size="lg"
                  className="mt-4 w-full"
                  disabled={!canSubmit || submitting}
                  loading={submitting}
                  leftIcon={Check}
                  onClick={submitOrder}
                >
                  {submitting ? 'Submitting…' : 'Submit Order'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
  )
}

export default function CartPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <ProtectedRoute allowedRoles={['member', 'rep', 'admin']}>
        <CartPageContent />
      </ProtectedRoute>
    </Suspense>
  )
}
