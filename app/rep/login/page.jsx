'use client'
import { useEffect, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { AlertCircle, ArrowLeft, KeyRound, Package, Phone, ShieldCheck, ShoppingBasket, Store, Users, ChevronDown } from 'lucide-react'
import EntryHeader from '../../components/EntryHeader'

export default function RepLoginPage() {
  const [code, setCode] = useState('')
  const [phone, setPhone] = useState('')
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(false)
  const { login } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const rawModule = (searchParams.get('module') || 'food').toLowerCase()
  const portalModule = rawModule === 'ram' ? 'ram' : rawModule === 'exhibition' ? 'exhibition' : 'food'
  const isRam = portalModule === 'ram'
  const isExhibition = portalModule === 'exhibition'
  const isFood = portalModule === 'food'

  // ── Multi-step login state for Food module ──
  // Steps: 'passcode' → 'department-question' → 'department-phone' → done
  const [loginStep, setLoginStep] = useState('passcode')
  const [isDeptRep, setIsDeptRep] = useState(null) // null = not answered, true/false
  const [departments, setDepartments] = useState([])
  const [selectedDept, setSelectedDept] = useState('')
  const [branchRepPhone, setBranchRepPhone] = useState('') // existing phone from DB
  const [branchCode, setBranchCode] = useState('') // validated branch code
  const [branchName, setBranchName] = useState('')
  const [branchId, setBranchId] = useState(null)

  // ── localStorage keys for remembering prefs ──
  const prefsKey = (bc) => `rep_food_prefs_${bc}`

  // Fetch departments list when needed
  useEffect(() => {
    if (loginStep === 'department-question' || loginStep === 'department-phone') {
      fetch('/api/departments/list', { cache: 'no-store' })
        .then((r) => r.json())
        .then((j) => { if (j?.ok) setDepartments(j.departments || []) })
        .catch(() => {})
    }
  }, [loginStep])

  const submitPasscode = async () => {
    setLoading(true); setMsg('')
    try {
      const res = await fetch('/api/rep/session', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ module: portalModule, passcode: code.trim().toUpperCase() })
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || 'Failed')

      // ── RAM / Exhibition: keep existing flow (no department question) ──
      if (isRam || isExhibition) {
        const base = {
          type: 'rep',
          id: code.trim().toUpperCase(),
          authenticated: true,
          module: portalModule,
        }
        if (json.module === 'ram') {
          login({
            ...base,
            vendorId: json.vendor?.id ?? null,
            vendorName: json.vendor?.name ?? '',
            vendorCode: json.vendor?.code ?? '',
          })
        } else {
          login({
            ...base,
            branchCode: json.branch?.code ?? code.trim().toUpperCase(),
            branchName: json.branch?.name ?? '',
            branchId: json.branch?.id ?? null,
          })
        }
        router.push('/rep')
        return
      }

      // ── Food module: multi-step flow ──
      const bc = json.branch?.code || code.trim().toUpperCase()
      const bn = json.branch?.name || ''
      const bid = json.branch?.id || null
      const existingPhone = json.rep_phone || ''
      setBranchCode(bc)
      setBranchName(bn)
      setBranchId(bid)
      setBranchRepPhone(existingPhone)

      // Check if we have saved preferences for this branch
      try {
        const saved = JSON.parse(localStorage.getItem(prefsKey(bc)) || '{}')

        if (saved.isDeptRep !== undefined && saved.department) {
          // Saved prefs exist — skip prompts, go straight to dashboard
          setPhone(saved.phone || existingPhone || '')
          setSelectedDept(saved.department || '')
          setIsDeptRep(saved.isDeptRep)

          // Save phone to DB if we have one and it's not already saved
          const phoneToSave = saved.phone || existingPhone
          if (phoneToSave) {
            await fetch('/api/rep/profile/phone', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
              body: JSON.stringify({ rep_phone: phoneToSave }),
            }).catch(() => null)
          }

          login({
            type: 'rep',
            id: bc,
            authenticated: true,
            module: 'food',
            branchCode: bc,
            branchName: bn,
            branchId: bid,
            ...(saved.isDeptRep && saved.department ? { department: saved.department } : {}),
          })
          router.push('/rep')
          return
        }
      } catch {}

      // No saved prefs — show the department question
      setLoginStep('department-question')
    } catch (e) {
      setMsg(e.message)
    } finally {
      setLoading(false)
    }
  }

  const submitDepartmentQuestion = (answer) => {
    setIsDeptRep(answer)
    if (answer) {
      // Department rep — show dept dropdown + phone
      setLoginStep('department-phone')
    } else {
      // General rep — if phone exists, skip to dashboard
      if (branchRepPhone) {
        finishLogin({ isDeptRep: false, department: '', phone: branchRepPhone })
      } else {
        // No phone on file — ask for it
        setLoginStep('department-phone')
        setSelectedDept('__general__') // sentinel for "not a department rep"
      }
    }
  }

  const submitDeptAndPhone = async () => {
    setLoading(true); setMsg('')
    try {
      const phoneClean = phone.trim()

      // Validate department selection
      if (isDeptRep && !selectedDept) {
        setMsg('Please select your department')
        setLoading(false)
        return
      }

      // If not a department rep but no phone entered
      if (!isDeptRep && !branchRepPhone && !phoneClean) {
        setMsg('Please enter your phone number')
        setLoading(false)
        return
      }

      const phoneToSave = isDeptRep ? phoneClean : (phoneClean || branchRepPhone)

      // Save phone to DB
      if (phoneToSave) {
        await fetch('/api/rep/profile/phone', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ rep_phone: phoneToSave }),
        }).catch(() => null)
      }

      const deptName = isDeptRep ? selectedDept : ''

      finishLogin({
        isDeptRep: isDeptRep,
        department: deptName,
        phone: phoneToSave,
      })
    } catch (e) {
      setMsg(e.message)
    } finally {
      setLoading(false)
    }
  }

  const finishLogin = ({ isDeptRep: isDept, department, phone: phoneVal }) => {
    // Save prefs to localStorage
    try {
      localStorage.setItem(prefsKey(branchCode), JSON.stringify({
        isDeptRep: isDept,
        department,
        phone: phoneVal,
      }))
    } catch {}

    login({
      type: 'rep',
      id: branchCode,
      authenticated: true,
      module: 'food',
      branchCode,
      branchName,
      branchId,
      ...(isDept && department ? { department } : {}),
    })
    router.push('/rep')
  }

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <EntryHeader
        subtitle="Rep Portal"
        links={[{ href: '/rep/access', label: 'Change module', icon: ArrowLeft }]}
      />
      <main className="relative flex flex-1 items-center justify-center overflow-hidden p-4">
        {/* Ambient glows */}
        <div className="pointer-events-none absolute -left-24 -top-24 h-80 w-80 rounded-full bg-brand-500/10 blur-3xl" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-brand/10 blur-3xl" aria-hidden="true" />

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: 'easeOut' }}
          className="relative w-full max-w-md"
        >
          <div className="ui-card relative p-6 sm:p-8">
            {/* Header */}
            <div className="mb-6 flex flex-col items-center text-center">
              <div className="relative mb-4">
                <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-brand text-2xl font-bold text-on-accent shadow-lg shadow-brand/30">
                  R
                </span>
                <span className="absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full border-2 border-surface bg-brand-hover" aria-hidden="true" />
              </div>
              <h1 className="text-h2 font-bold tracking-tight text-fg">
                {isRam ? 'Ram Sales Rep Portal' : isExhibition ? 'Coop Exhibition Rep Portal' : 'Food Distribution Rep Portal'}
              </h1>
              <p className="mt-1 text-sm text-muted">
                {loginStep === 'passcode'
                  ? 'Enter your passcode to continue.'
                  : loginStep === 'department-question'
                    ? 'Quick question before you proceed.'
                    : 'Set up your department and contact.'}
              </p>
              <span className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-brand-subtle px-3 py-1 text-xs font-semibold text-brand-fg">
                {isRam ? <ShoppingBasket className="h-3.5 w-3.5" aria-hidden="true" /> : isExhibition ? <Store className="h-3.5 w-3.5" aria-hidden="true" /> : <Package className="h-3.5 w-3.5" aria-hidden="true" />}
                {isRam ? 'Ram Sales' : isExhibition ? 'Coop Exhibition' : 'Food Distribution'} module
              </span>
            </div>

            <AnimatePresence mode="wait">
              {/* ── Step 1: Passcode ── */}
              {loginStep === 'passcode' && (
                <motion.div
                  key="passcode"
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 12 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-4"
                >
                  <div>
                    <label htmlFor="rep-code" className="mb-1.5 block text-xs font-medium text-subtext">
                      Rep passcode
                    </label>
                    <div className="relative">
                      <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtext" aria-hidden="true" />
                      <input
                        id="rep-code"
                        className="w-full rounded-lg border border-line bg-surface py-2 pl-10 pr-3 text-sm text-fg placeholder:text-subtext transition-colors duration-200 ease-sakani focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
                        value={code}
                        onChange={e=>setCode(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && code.trim()) submitPasscode() }}
                        placeholder="Enter your passcode"
                        autoComplete="off"
                        autoCapitalize="characters"
                        autoCorrect="off"
                        spellCheck="false"
                      />
                    </div>
                  </div>
                  <button
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-on-accent transition-all duration-200 ease-sakani hover:bg-brand-hover active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={submitPasscode}
                    disabled={loading || !code.trim()}
                  >
                    {loading ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-on-accent border-t-transparent" />
                        <span>Checking…</span>
                      </span>
                    ) : (
                      'Continue'
                    )}
                  </button>
                </motion.div>
              )}

              {/* ── Step 2: Are you a department rep? ── */}
              {loginStep === 'department-question' && (
                <motion.div
                  key="question"
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 12 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-4"
                >
                  <div className="rounded-xl border border-line bg-subtle/40 p-4 text-center">
                    <Users className="mx-auto h-8 w-8 text-brand" strokeWidth={1.8} />
                    <p className="mt-2 text-sm font-medium text-fg">
                      Welcome, <span className="font-semibold">{branchName || branchCode}</span>
                    </p>
                    <p className="mt-1 text-sm text-muted">
                      Are you a department rep?
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => submitDepartmentQuestion(true)}
                      className="rounded-xl border border-brand bg-brand-subtle px-4 py-3 text-sm font-semibold text-brand transition-all duration-200 hover:bg-brand/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                    >
                      Yes, I am
                    </button>
                    <button
                      type="button"
                      onClick={() => submitDepartmentQuestion(false)}
                      className="rounded-xl border border-line bg-surface px-4 py-3 text-sm font-semibold text-fg transition-all duration-200 hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                    >
                      No, general rep
                    </button>
                  </div>
                </motion.div>
              )}

              {/* ── Step 3: Department + Phone ── */}
              {loginStep === 'department-phone' && (
                <motion.div
                  key="dept-phone"
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 12 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-4"
                >
                  {/* Department dropdown (only for department reps) */}
                  {isDeptRep && (
                    <div>
                      <label htmlFor="rep-dept" className="mb-1.5 block text-xs font-medium text-subtext">
                        Your department
                      </label>
                      <div className="relative">
                        <Users className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtext" aria-hidden="true" />
                        <select
                          id="rep-dept"
                          value={selectedDept}
                          onChange={(e) => setSelectedDept(e.target.value)}
                          className="w-full appearance-none rounded-lg border border-line bg-surface py-2 pl-10 pr-9 text-sm text-fg transition-colors duration-200 ease-sakani focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
                        >
                          <option value="">Select your department</option>
                          {departments.map((d) => (
                            <option key={d.name || d} value={d.name || d}>{d.name || d}</option>
                          ))}
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtext" aria-hidden="true" />
                      </div>
                    </div>
                  )}

                  {/* Phone field */}
                  <div>
                    <label htmlFor="rep-phone" className="mb-1.5 block text-xs font-medium text-subtext">
                      {isDeptRep ? 'Your phone number' : 'Rep phone number'}
                      {!isDeptRep && !branchRepPhone && <span className="ml-1 text-danger">*</span>}
                    </label>
                    <div className="relative">
                      <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtext" aria-hidden="true" />
                      <input
                        id="rep-phone"
                        className="w-full rounded-lg border border-line bg-surface py-2 pl-10 pr-3 text-sm text-fg placeholder:text-subtext transition-colors duration-200 ease-sakani focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder={branchRepPhone && !isDeptRep ? branchRepPhone : 'e.g. 08012345678'}
                        type="tel"
                        autoComplete="tel"
                      />
                    </div>
                    {branchRepPhone && !isDeptRep && (
                      <p className="mt-1 text-xs text-muted">
                        Phone on file: {branchRepPhone}
                      </p>
                    )}
                  </div>

                  <button
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-on-accent transition-all duration-200 ease-sakani hover:bg-brand-hover active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={submitDeptAndPhone}
                    disabled={loading || (isDeptRep && !selectedDept)}
                  >
                    {loading ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-on-accent border-t-transparent" />
                        <span>Setting up…</span>
                      </span>
                    ) : (
                      'Continue to Dashboard'
                    )}
                  </button>

                  {/* Back to question */}
                  <button
                    type="button"
                    onClick={() => { setLoginStep('department-question'); setPhone(''); setSelectedDept('') }}
                    className="w-full text-center text-xs text-muted hover:text-fg transition-colors"
                  >
                    ← Go back
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {msg && (
              <div
                role="alert"
                className="mt-4 flex items-start gap-2 rounded-lg border border-danger-border bg-danger-bg p-3 text-sm text-danger-fg"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{msg}</span>
              </div>
            )}
          </div>

          <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-xs text-muted">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            Authorized personnel only. All access is logged.
          </p>
        </motion.div>
      </main>
    </div>
  )
}
