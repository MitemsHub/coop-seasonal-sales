// app/admin/orders/page.jsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import ProtectedRoute from '../../../components/ProtectedRoute'

function AdminOrdersPageContent() {
  const router = useRouter()
  const [orders, setOrders] = useState([])
  const [members, setMembers] = useState([])
  const [selectedMember, setSelectedMember] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState(null)

  useEffect(() => {
    loadMembers()
    loadAllOrders()
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
    }
  }

  const loadAllOrders = async () => {
    setLoading(true)
    try {
      let query = supabase
        .from('orders')
        .select(`
          *,
          members!inner(full_name, branch_code),
          branches!delivery_branch_code(name),
          departments(name),
          order_lines(
            id,
            qty,
            unit_price,
            amount,
            items(sku, name, unit)
          )
        `)
        .order('created_at', { ascending: false })

      if (selectedMember) {
        query = query.eq('member_id', selectedMember)
      }

      if (statusFilter) {
        query = query.eq('status', statusFilter)
      }

      const { data, error } = await query
      
      if (error) throw error
      setOrders(data || [])
    } catch (error) {
      console.error('Error loading orders:', error)
      setMessage({ type: 'error', text: 'Failed to load orders' })
    } finally {
      setLoading(false)
    }
  }

  const handleFilterChange = () => {
    loadAllOrders()
  }

  const downloadReceipt = async (orderId, memberId) => {
    try {
      // Redirect to the existing success page for PDF download
      window.open(`/shop/success/${orderId}?mid=${memberId}`, '_blank')
    } catch (error) {
      console.error('Error downloading receipt:', error)
      setMessage({ type: 'error', text: 'Failed to download receipt' })
    }
  }

  const getStatusBadge = (status) => {
    const statusStyles = {
      'pending': 'bg-warning-bg text-warning-fg',
      'posted': 'bg-info-bg text-info-fg',
      'delivered': 'bg-success-bg text-success-fg',
      'cancelled': 'bg-danger-bg text-danger-fg'
    }
    
    return (
      <span className={`px-fluid-xs py-fluid-2xs rounded-full text-xs font-medium ${statusStyles[status] || 'bg-subtle text-muted'}`}>
        {status?.charAt(0).toUpperCase() + status?.slice(1) || 'Unknown'}
      </span>
    )
  }

  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="mb-6 flex flex-col gap-2">
          <div>
            <h1 className="text-h2 font-bold tracking-tight text-fg">All Member Orders</h1>
            <p className="text-sm text-muted">View and manage all member orders across the system</p>
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

        {/* Filters */}
        <div className="ui-card p-4 mb-4">
          <h2 className="text-[13px] font-semibold text-fg mb-3">Filters</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-muted">Member</label>
              <select
                value={selectedMember}
                onChange={(e) => {
                  setSelectedMember(e.target.value)
                  setTimeout(handleFilterChange, 100)
                }}
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
              >
                <option value="">All Members</option>
                {members.map(member => (
                  <option key={member.member_id} value={member.member_id}>
                    {member.full_name} ({member.member_id})
                  </option>
                ))}
              </select>
            </div>
            
            <div>
              <label className="mb-2 block text-sm font-medium text-muted">Status</label>
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value)
                  setTimeout(handleFilterChange, 100)
                }}
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
              >
                <option value="">All Statuses</option>
                <option value="pending">Pending</option>
                <option value="posted">Posted</option>
                <option value="delivered">Delivered</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            
            <div className="flex items-end">
              <button
                onClick={handleFilterChange}
                className="w-full rounded-lg bg-brand px-4 py-2 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:bg-brand-hover disabled:opacity-50"
                disabled={loading}
              >
                {loading ? 'Loading...' : 'Refresh'}
              </button>
            </div>
          </div>
        </div>

        {/* Orders List */}
        <div className="ui-card overflow-hidden">
          <div className="border-b border-line p-6">
            <h2 className="text-[15px] font-semibold text-fg">Orders ({orders.length})</h2>
          </div>
          
          {loading ? (
            <div className="py-12 text-center">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-line border-t-brand"></div>
              <p className="mt-3 text-sm text-muted">Loading orders...</p>
            </div>
          ) : orders.length === 0 ? (
            <div className="py-12 text-center text-muted">
              <svg className="mx-auto mb-3 h-16 w-16 text-subtext" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-sm">No orders found</p>
            </div>
          ) : (
            <div className="divide-y divide-line">
              {orders.map(order => (
                <div key={order.order_id} className="p-6">
                  <div className="mb-2 flex items-start justify-between lg:mb-3">
                    <div>
                      <div className="mb-2 flex items-center gap-3">
                        <h3 className="text-[15px] font-semibold text-fg">Order #{order.order_id}</h3>
                        {getStatusBadge(order.status)}
                      </div>
                      <div className="space-y-1 text-sm text-muted">
                        <p><strong className="font-medium text-fg">Member:</strong> {order.members?.full_name} ({order.member_id})</p>
                        <p><strong className="font-medium text-fg">Branch:</strong> {order.members?.branch_code}</p>
                        <p><strong className="font-medium text-fg">Delivery:</strong> {order.branches?.name}</p>
                        <p><strong className="font-medium text-fg">Department:</strong> {order.departments?.name}</p>
                        <p><strong className="font-medium text-fg">Payment:</strong> {order.payment_option}</p>
                        <p><strong className="font-medium text-fg">Date:</strong> {new Date(order.created_at).toLocaleString()}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="mb-2 text-[15px] font-bold text-success-fg sm:text-xl">
                        ₦{Number(order.total_amount || 0).toLocaleString()}
                      </div>
                      <div className="flex gap-2">
                        {(order.status === 'delivered' || order.status === 'posted') && (
                          <button
                            onClick={() => downloadReceipt(order.order_id, order.member_id)}
                            className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:bg-brand-hover"
                          >
                            Receipt
                          </button>
                        )}
                        <button
                          onClick={() => router.push(`/admin/food/pending`)}
                          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:bg-accent-hover"
                        >
                          Manage
                        </button>
                      </div>
                    </div>
                  </div>
                  
                  {/* Order Items */}
                  <div className="rounded-lg bg-subtle p-4">
                    <h4 className="mb-3 font-medium text-fg">Order Items</h4>
                    <div className="space-y-2">
                      {(order.order_lines || []).map(line => (
                        <div key={line.id} className="flex justify-between items-center text-sm">
                          <div>
                            <span className="font-medium text-fg">{line.items?.name}</span>
                            <span className="ml-2 text-subtext">({line.items?.sku})</span>
                          </div>
                          <div className="text-right">
                            <div className="text-muted">{line.qty} {line.items?.unit} × ₦{Number(line.unit_price).toLocaleString()}</div>
                            <div className="font-medium text-fg">₦{Number(line.amount).toLocaleString()}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </ProtectedRoute>
  )
}

export default function AdminOrdersPage() {
  return <AdminOrdersPageContent />
}
