// app/admin/cart/page.jsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import ProtectedRoute from '../../../components/ProtectedRoute'

function AdminCartPageContent() {
  const router = useRouter()
  const [members, setMembers] = useState([])
  const [selectedMember, setSelectedMember] = useState('')
  const [cartData, setCartData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState(null)

  // Load all members for selection
  useEffect(() => {
    loadMembers()
  }, [])

  const loadMembers = async () => {
    try {
      const { data, error } = await supabase
        .from('members')
        .select(`
          member_id, 
          full_name, 
          branches:branch_id(code)
        `)
        .order('full_name')
      
      if (error) throw error
      setMembers(data || [])
    } catch (error) {
      console.error('Error loading members:', error)
      setMessage({ type: 'error', text: 'Failed to load members' })
    }
  }

  const loadMemberCart = async (memberId) => {
    if (!memberId) {
      setCartData(null)
      return
    }

    setLoading(true)
    try {
      // Try to get cart data from localStorage simulation or database
      // For now, we'll redirect to the actual cart page with admin privileges
      router.push(`/cart?member_id=${memberId}&admin=true`)
    } catch (error) {
      console.error('Error loading cart:', error)
      setMessage({ type: 'error', text: 'Failed to load cart data' })
    } finally {
      setLoading(false)
    }
  }

  const handleMemberSelect = (memberId) => {
    setSelectedMember(memberId)
    if (memberId) {
      loadMemberCart(memberId)
    }
  }

  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="mb-6 flex flex-col gap-2">
          <div>
            <h1 className="text-h2 font-bold tracking-tight text-fg">Member Carts</h1>
            <p className="text-sm text-muted">View and manage member shopping carts</p>
          </div>
        </div>

        {message && (
          <div role="alert" className={`mb-4 rounded-xl border p-4 text-sm ${
            message.type === 'error' ? 'border-danger-border bg-danger-bg text-danger-fg' : 
            'border-success-border bg-success-bg text-success-fg'
          }`}>
            {message.text}
          </div>
        )}

        <div className="ui-card p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-fg">Select Member</h2>
            <button
              onClick={() => router.push('/admin/food/pending')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:bg-accent-hover"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Back to Admin
            </button>
          </div>

          <div className="mb-6">
            <label className="mb-2 block text-sm font-medium text-muted">Member</label>
            <select
              value={selectedMember}
              onChange={(e) => handleMemberSelect(e.target.value)}
              className="w-full rounded-lg border border-line bg-surface px-4 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
            >
              <option value="">Choose a member...</option>
              {members.map(member => (
                <option key={member.member_id} value={member.member_id}>
                  {member.full_name} ({member.member_id}) - {member.branches?.code || 'No Branch'}
                </option>
              ))}
            </select>
          </div>

          {loading && (
            <div className="py-8 text-center">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-line border-t-brand"></div>
              <p className="mt-3 text-sm text-muted">Loading cart data...</p>
            </div>
          )}

          {!selectedMember && !loading && (
            <div className="py-8 text-center text-muted">
              <svg className="mx-auto mb-4 h-16 w-16 text-subtext" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4m0 0L7 13m0 0l-1.1 5H17M9 19.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM20.5 19.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
              </svg>
              <p className="text-sm">Select a member to view their cart</p>
            </div>
          )}
        </div>

        <div className="mt-6 rounded-xl border border-info-border bg-info-bg p-4">
          <h3 className="mb-2 font-semibold text-info-fg">Admin Cart Management</h3>
          <ul className="space-y-1 text-sm text-info-fg">
            <li>• View any member's current cart items</li>
            <li>• Edit quantities and remove items</li>
            <li>• Process cart submissions on behalf of members</li>
            <li>• Monitor cart activity across all branches</li>
          </ul>
        </div>
      </div>
    </ProtectedRoute>
  )
}

export default function AdminCartPage() {
  return <AdminCartPageContent />
}
