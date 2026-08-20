'use client'

// app/admin/chat/page.jsx
// Admin live-chat panel — lists member conversations on the left,
// shows the selected thread on the right, and lets the admin reply.
// Features: search, read/unread filter, pagination, file sharing, notifications.
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { MessageCircle, Send, ArrowLeft, Paperclip, AlertCircle, Search, X, ChevronLeft, ChevronRight, Filter } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'

const PAGE_SIZE = 20

export default function AdminChatPage() {
  const { user } = useAuth()
  const [conversations, setConversations] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [loadingConvs, setLoadingConvs] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [totalUnread, setTotalUnread] = useState(0)
  const [debugInfo, setDebugInfo] = useState(null)
  const scrollRef = useRef(null)
  const fileInputRef = useRef(null)
  const prevTotalUnread = useRef(0)

  // ── Search & filter state ──
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all') // 'all' | 'unread' | 'read'
  const [page, setPage] = useState(0)

  const adminId = user?.id || 'admin'
  const adminName = user?.name || 'Admin'

  // ── Notification sound for new incoming messages ──
  const playNotificationSound = useCallback(() => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)()
      const now = ctx.currentTime
      const osc1 = ctx.createOscillator()
      const osc2 = ctx.createOscillator()
      const gain = ctx.createGain()
      osc1.connect(gain)
      osc2.connect(gain)
      gain.connect(ctx.destination)
      osc1.frequency.value = 660
      osc2.frequency.value = 880
      osc1.type = 'sine'
      osc2.type = 'sine'
      gain.gain.value = 0.12
      osc1.start(now)
      osc2.start(now + 0.1)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3)
      osc1.stop(now + 0.3)
      osc2.stop(now + 0.3)
    } catch {}
  }, [])

  // ── Fetch conversation list ──
  const fetchConversations = useCallback(async () => {
    try {
      const res = await fetch('/api/chat/messages?all=true')
      const json = await res.json()
      if (json.ok) {
        setConversations(json.conversations || [])
        setDebugInfo(null)
      } else {
        setDebugInfo(json.error || 'Failed to load conversations')
      }
    } catch (e) {
      setDebugInfo(e.message || 'Network error')
    } finally {
      setLoadingConvs(false)
    }
  }, [])

  // ── Fetch total unread count ──
  const fetchUnreadCount = useCallback(async () => {
    try {
      const res = await fetch('/api/chat/messages?unread=true')
      const json = await res.json()
      if (json.ok) {
        const count = json.count || 0
        if (count > prevTotalUnread.current) {
          playNotificationSound()
        }
        prevTotalUnread.current = count
        setTotalUnread(count)
      }
    } catch {}
  }, [playNotificationSound])

  // ── Fetch messages for selected member ──
  const fetchMessages = useCallback(async () => {
    if (!selectedId) return
    try {
      const res = await fetch(`/api/chat/messages?sender_id=${encodeURIComponent(selectedId)}`)
      const json = await res.json()
      if (json.ok) setMessages(json.messages || [])
    } catch {}
  }, [selectedId])

  // ── Poll conversations + unread every 5s ──
  useEffect(() => {
    fetchConversations()
    fetchUnreadCount()
    const t = setInterval(() => {
      fetchConversations()
      fetchUnreadCount()
    }, 5000)
    return () => clearInterval(t)
  }, [fetchConversations, fetchUnreadCount])

  // ── Poll messages every 3s when a thread is open ──
  useEffect(() => {
    if (!selectedId) return
    fetchMessages()
    const t = setInterval(fetchMessages, 3000)
    return () => clearInterval(t)
  }, [selectedId, fetchMessages])

  // ── Auto-scroll ──
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages])

  // ── Mark as read when opening a thread ──
  useEffect(() => {
    if (!selectedId) return
    fetch('/api/chat/read', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender_id: selectedId }),
    }).catch(() => {})
  }, [selectedId])

  // ── Reset page when search or filter changes ──
  useEffect(() => { setPage(0) }, [search, filter])

  // ── Filtered + paginated conversations ──
  const filteredConvs = useMemo(() => {
    let list = conversations

    // Search filter
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter((c) =>
        (c.sender_name || '').toLowerCase().includes(q) ||
        (c.sender_id || '').toLowerCase().includes(q) ||
        (c.last_message || '').toLowerCase().includes(q)
      )
    }

    // Read/unread filter
    if (filter === 'unread') {
      list = list.filter((c) => c.has_unread)
    } else if (filter === 'read') {
      list = list.filter((c) => !c.has_unread)
    }

    return list
  }, [conversations, search, filter])

  const pageCount = Math.max(1, Math.ceil(filteredConvs.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const visibleConvs = filteredConvs.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)

  // ── Upload file ──
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file || !selectedId) return
    e.target.value = ''

    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('sender_id', selectedId)

      const res = await fetch('/api/chat/upload', { method: 'POST', body: formData })
      const json = await res.json()

      if (json.ok) {
        const sendRes = await fetch('/api/chat/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sender_type: 'admin',
            sender_id: selectedId,
            sender_name: adminName,
            message: '',
            attachment_url: json.url,
            attachment_type: json.type,
            attachment_name: json.name,
          }),
        })
        const sendJson = await sendRes.json()
        if (sendJson.ok && sendJson.message) {
          setMessages((prev) => [...prev, sendJson.message])
        }
      }
    } catch {} finally {
      setUploading(false)
    }
  }

  // ── Send reply ──
  const handleSend = async () => {
    const text = input.trim()
    if (!text || sending || !selectedId) return

    setSending(true)
    setInput('')

    const optimistic = {
      id: Date.now(),
      sender_type: 'admin',
      sender_id: adminId,
      sender_name: adminName,
      message: text,
      created_at: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, optimistic])

    try {
      const res = await fetch('/api/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender_type: 'admin',
          sender_id: selectedId,
          sender_name: adminName,
          message: text,
        }),
      })
      const json = await res.json()
      if (json.ok && json.message) {
        setMessages((prev) =>
          prev.map((m) => (m.id === optimistic.id ? { ...json.message } : m))
        )
      }
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id))
    } finally {
      setSending(false)
    }
  }

  // ── Render attachment inside message bubble ──
  const renderAttachment = (msg) => {
    if (!msg.attachment_url) return null
    if (msg.attachment_type === 'image') {
      return (
        <a href={msg.attachment_url} target="_blank" rel="noopener noreferrer" className="block mt-1">
          <img
            src={msg.attachment_url}
            alt={msg.attachment_name || 'Image'}
            className="max-h-48 rounded-lg object-cover border border-line-subtle"
            loading="lazy"
          />
        </a>
      )
    }
    return (
      <a
        href={msg.attachment_url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1 flex items-center gap-2 rounded-lg border border-line-subtle bg-canvas px-3 py-2 text-xs text-fg hover:bg-subtle transition-colors"
      >
        <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted" />
        <span className="truncate">{msg.attachment_name || 'File'}</span>
      </a>
    )
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col rounded-xl border border-line bg-surface shadow-sm overflow-hidden">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.pdf,.doc,.docx,.txt"
        className="hidden"
        onChange={handleFileUpload}
      />

      {/* Title bar */}
      <div className="flex items-center gap-3 border-b border-line-subtle px-5 py-3">
        <MessageCircle className="h-5 w-5 text-brand" />
        <h1 className="text-lg font-semibold text-fg">Live Chat</h1>
        <span className="text-sm text-muted">
          {filteredConvs.length} conversation{filteredConvs.length !== 1 ? 's' : ''}
        </span>
        {totalUnread > 0 && (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-danger/10 px-2.5 py-0.5 text-xs font-medium text-danger">
            <AlertCircle className="h-3 w-3" />
            {totalUnread} unread
          </span>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Conversation list sidebar */}
        <div
          className={`flex w-full shrink-0 flex-col border-r border-line-subtle md:w-80 ${
            selectedId ? 'hidden md:flex' : 'flex'
          }`}
        >
          {/* Search bar */}
          <div className="border-b border-line-subtle px-3 py-2.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or message…"
                className="w-full rounded-lg border border-line bg-canvas py-2 pl-8 pr-8 text-xs text-fg placeholder:text-muted focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/30"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted hover:text-fg"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>

          {/* Filter tabs */}
          <div className="flex border-b border-line-subtle">
            {[
              { key: 'all', label: 'All' },
              { key: 'unread', label: 'Unread', count: totalUnread },
              { key: 'read', label: 'Read' },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setFilter(tab.key)}
                className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                  filter === tab.key
                    ? 'border-b-2 border-brand text-brand'
                    : 'text-muted hover:text-fg'
                }`}
              >
                {tab.label}
                {tab.count > 0 && (
                  <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-danger/10 px-1 text-[9px] font-bold text-danger">
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Conversation list */}
          <div className="flex-1 overflow-y-auto">
            {loadingConvs ? (
              <p className="p-4 text-sm text-muted">Loading…</p>
            ) : debugInfo ? (
              <div className="p-4">
                <p className="text-sm font-medium text-danger">Error:</p>
                <p className="mt-1 text-xs text-danger/80 break-all">{debugInfo}</p>
                <p className="mt-2 text-xs text-muted">
                  Visit <a href="/api/chat/test" target="_blank" className="underline">/api/chat/test</a> for diagnostics
                </p>
              </div>
            ) : visibleConvs.length === 0 ? (
              <p className="p-4 text-sm text-muted">
                {search || filter !== 'all' ? 'No conversations match your filters.' : 'No conversations yet.'}
              </p>
            ) : (
              visibleConvs.map((conv) => (
                <button
                  key={conv.sender_id}
                  onClick={() => setSelectedId(conv.sender_id)}
                  className={`w-full border-b border-line-subtle px-4 py-3 text-left transition-colors hover:bg-subtle ${
                    selectedId === conv.sender_id ? 'bg-brand/5' : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-fg truncate">
                      {conv.sender_name || conv.sender_id}
                    </span>
                    <span className="text-[10px] text-muted whitespace-nowrap ml-2">
                      {new Date(conv.last_at).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  {conv.sender_name && (
                    <p className="text-[10px] text-muted/70 mt-0.5">{conv.sender_id}</p>
                  )}
                  <div className="flex items-center justify-between mt-0.5">
                    <p className="text-xs text-muted truncate flex-1">{conv.last_message}</p>
                    {conv.has_unread && (
                      <span className="ml-2 h-2 w-2 shrink-0 rounded-full bg-brand" />
                    )}
                  </div>
                </button>
              ))
            )}
          </div>

          {/* Pagination */}
          {pageCount > 1 && (
            <div className="flex items-center justify-between border-t border-line-subtle px-3 py-2">
              <button
                disabled={safePage === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-line bg-surface px-2 text-[10px] font-medium text-fg transition-colors hover:bg-subtle disabled:opacity-40"
              >
                <ChevronLeft className="h-3 w-3" /> Prev
              </button>
              <span className="text-[10px] text-muted">
                {safePage + 1} / {pageCount}
              </span>
              <button
                disabled={safePage >= pageCount - 1}
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-line bg-surface px-2 text-[10px] font-medium text-fg transition-colors hover:bg-subtle disabled:opacity-40"
              >
                Next <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>

        {/* Chat thread */}
        <div className={`flex min-w-0 flex-1 flex-col ${!selectedId ? 'hidden md:flex' : 'flex'}`}>
          {!selectedId ? (
            <div className="flex flex-1 items-center justify-center text-muted text-sm">
              Select a conversation to start chatting
            </div>
          ) : (
            <>
              {/* Thread header */}
              <div className="flex items-center gap-2 border-b border-line-subtle px-4 py-2.5">
                <button
                  onClick={() => setSelectedId(null)}
                  className="md:hidden inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-subtle hover:text-fg"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <div className="min-w-0">
                  <span className="text-sm font-medium text-fg">
                    {conversations.find((c) => c.sender_id === selectedId)?.sender_name || selectedId}
                  </span>
                  {conversations.find((c) => c.sender_id === selectedId)?.sender_name && (
                    <span className="ml-1.5 text-xs text-muted">
                      ({selectedId})
                    </span>
                  )}
                </div>
              </div>

              {/* Messages */}
              <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto px-4 py-3 space-y-3"
              >
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${msg.sender_type === 'admin' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${
                        msg.sender_type === 'admin'
                          ? 'bg-brand text-on-accent rounded-br-sm'
                          : 'bg-subtle text-fg rounded-bl-sm'
                      }`}
                    >
                      {msg.sender_type === 'member' && (
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted mb-0.5">
                          {msg.sender_name || 'Member'}
                        </p>
                      )}
                      {msg.message && (
                        <p className="whitespace-pre-wrap break-words">{msg.message}</p>
                      )}
                      {renderAttachment(msg)}
                      <p
                        className={`mt-1 text-[10px] ${
                          msg.sender_type === 'admin' ? 'text-on-accent/60' : 'text-muted'
                        }`}
                      >
                        {new Date(msg.created_at).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Input */}
              <div className="border-t border-line-subtle px-4 py-3">
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    handleSend()
                  }}
                  className="flex items-center gap-2"
                >
                  {/* Attach button */}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading || !selectedId}
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line text-muted transition-colors hover:bg-subtle hover:text-fg disabled:opacity-40"
                    aria-label="Attach file"
                  >
                    {uploading ? (
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-transparent" />
                    ) : (
                      <Paperclip className="h-4 w-4" />
                    )}
                  </button>
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Type a reply…"
                    className="flex-1 rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-fg placeholder:text-muted focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/30"
                    disabled={sending}
                  />
                  <button
                    type="submit"
                    disabled={!input.trim() || sending}
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand text-on-accent transition-opacity hover:opacity-90 disabled:opacity-40"
                    aria-label="Send reply"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </form>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
