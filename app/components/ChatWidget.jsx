'use client'

// app/components/ChatWidget.jsx
// Floating live-chat widget — members click the bubble to open a panel
// and exchange messages with an admin in real time.
// Position-aware: shifts up when BackToTop or cart bars are visible.
import { useState, useEffect, useRef, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { MessageCircle, X, Send, Minus, Paperclip, Image as ImageIcon } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

export default function ChatWidget() {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [minimized, setMinimized] = useState(false)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [unread, setUnread] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [bottomOffset, setBottomOffset] = useState(24) // default bottom-6
  const scrollRef = useRef(null)
  const pollRef = useRef(null)
  const fileInputRef = useRef(null)
  const prevAdminCount = useRef(0)
  const audioRef = useRef(null)

  const senderId = user?.id || 'guest'
  const senderName = user?.name || user?.type || 'Member'

  // ── Position awareness: shift up when BackToTop or cart bar is present ──
  useEffect(() => {
    const update = () => {
      const backToTop = document.querySelector('[aria-label="Back to top"]')
      const cartBar = document.querySelector('[data-cart-bar]')
      let offset = 24 // base: bottom-6

      if (cartBar) {
        offset = 104 // above cart bar + BackToTop raised
      } else if (backToTop) {
        offset = 80 // above BackToTop normal position
      }
      setBottomOffset(offset)
    }

    // Check on scroll and periodically
    window.addEventListener('scroll', update, { capture: true, passive: true })
    const t = setInterval(update, 800)
    update()
    return () => {
      window.removeEventListener('scroll', update, { capture: true })
      clearInterval(t)
    }
  }, [])

  // ── Notification sound (a short beep when admin replies) ──
  const playNotificationSound = useCallback(() => {
    try {
      if (!audioRef.current) {
        // Tiny inline base64 beep — no external file needed
        const ctx = new (window.AudioContext || window.webkitAudioContext)()
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.frequency.value = 880
        osc.type = 'sine'
        gain.gain.value = 0.15
        osc.start()
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15)
        osc.stop(ctx.currentTime + 0.15)
        audioRef.current = true // mark as played once
      }
    } catch {}
  }, [])

  // ── Fetch messages ──
  const fetchMessages = useCallback(async () => {
    try {
      const res = await fetch(`/api/chat/messages?sender_id=${encodeURIComponent(senderId)}`)
      const json = await res.json()
      if (json.ok && json.messages) {
        setMessages(json.messages)
        const adminCount = json.messages.filter(
          (m) => m.sender_type === 'admin' && !m.read_at
        ).length
        // Play sound when a new admin reply arrives
        if (adminCount > prevAdminCount.current && open) {
          playNotificationSound()
        }
        setUnread(adminCount)
        prevAdminCount.current = adminCount
      }
    } catch {}
  }, [senderId, open, playNotificationSound])

  // ── Poll for new messages every 4 seconds ──
  useEffect(() => {
    if (!user) return
    fetchMessages()
    pollRef.current = setInterval(fetchMessages, 4000)
    return () => clearInterval(pollRef.current)
  }, [user, fetchMessages])

  // ── Auto-scroll to bottom ──
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, open])

  // ── Mark messages as read when panel opens ──
  useEffect(() => {
    if (open && senderId && senderId !== 'guest') {
      audioRef.current = null
      prevAdminCount.current = 0
      setUnread(0)
      // Tell server to mark admin messages as read for this member
      fetch('/api/chat/read', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reader_id: senderId }),
      }).catch(() => {})
    }
  }, [open, senderId])

  // ── Upload file ──
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = '' // reset input

    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('sender_id', senderId)

      const res = await fetch('/api/chat/upload', { method: 'POST', body: formData })
      const json = await res.json()

      if (json.ok) {
        setUploadError('')
        // Send the attachment as a message
        const sendRes = await fetch('/api/chat/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sender_type: 'member',
            sender_id: senderId,
            sender_name: senderName,
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
      } else {
        setUploadError(json.error || 'Upload failed')
        setTimeout(() => setUploadError(''), 5000)
      }
    } catch (e) {
      setUploadError(e.message || 'Upload failed')
      setTimeout(() => setUploadError(''), 5000)
    } finally {
      setUploading(false)
    }
  }

  // ── Send text message ──
  const handleSend = async () => {
    const text = input.trim()
    if (!text || sending) return

    setSending(true)
    setInput('')

    const optimistic = {
      id: Date.now(),
      sender_type: 'member',
      sender_id: senderId,
      sender_name: senderName,
      message: text,
      created_at: new Date().toISOString(),
      read_at: null,
    }
    setMessages((prev) => [...prev, optimistic])

    try {
      const res = await fetch('/api/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender_type: 'member',
          sender_id: senderId,
          sender_name: senderName,
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

  // ── Render an attachment inside a message bubble ──
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

  if (!user) return null

  return (
    <>
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.pdf,.doc,.docx,.txt"
        className="hidden"
        onChange={handleFileUpload}
      />

      {/* Floating bubble */}
      <AnimatePresence>
        {!open && (
          <motion.button
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
            onClick={() => { setOpen(true); setMinimized(false) }}
            style={{ bottom: `${bottomOffset}px` }}
            className="fixed right-6 z-[90] flex h-14 w-14 items-center justify-center rounded-full bg-brand text-on-accent shadow-lg transition-all duration-300 hover:shadow-xl hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
            aria-label="Open live chat"
          >
            <MessageCircle className="h-6 w-6" />
            {unread > 0 && (
              <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-danger text-[10px] font-bold text-white animate-pulse">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </motion.button>
        )}
      </AnimatePresence>

      {/* Chat panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.2, ease: [0.33, 1, 0.68, 1] }}
            style={{ bottom: `${bottomOffset}px` }}
            className="fixed right-6 z-[90] flex w-[min(92vw,380px)] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between bg-brand px-4 py-3">
              <div className="flex items-center gap-2">
                <MessageCircle className="h-5 w-5 text-on-accent" />
                <span className="text-sm font-semibold text-on-accent">Live Chat</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setMinimized((m) => !m)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-on-accent/70 transition-colors hover:bg-on-accent/10 hover:text-on-accent"
                  aria-label={minimized ? 'Expand chat' : 'Minimize chat'}
                >
                  <Minus className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setOpen(false)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-on-accent/70 transition-colors hover:bg-on-accent/10 hover:text-on-accent"
                  aria-label="Close chat"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Body */}
            {!minimized && (
              <>
                {/* Messages */}
                <div
                  ref={scrollRef}
                  className="flex-1 overflow-y-auto px-4 py-3 space-y-3"
                  style={{ maxHeight: '340px', minHeight: '200px' }}
                >
                  {messages.length === 0 && (
                    <p className="text-center text-sm text-muted py-8">
                      Hi! How can we help you today?
                    </p>
                  )}
                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex ${msg.sender_type === 'member' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${
                          msg.sender_type === 'member'
                            ? 'bg-brand text-on-accent rounded-br-sm'
                            : 'bg-subtle text-fg rounded-bl-sm'
                        }`}
                      >
                        {msg.sender_type === 'admin' && (
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted mb-0.5">
                            Admin
                          </p>
                        )}
                        {msg.message && (
                          <p className="whitespace-pre-wrap break-words">{msg.message}</p>
                        )}
                        {renderAttachment(msg)}
                        <p
                          className={`mt-1 text-[10px] ${
                            msg.sender_type === 'member' ? 'text-on-accent/60' : 'text-muted'
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

                {/* Upload error */}
                {uploadError && (
                  <div className="mx-3 mt-2 rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-xs text-danger-fg">
                    {uploadError}
                  </div>
                )}

                {/* Input */}
                <div className="border-t border-line-subtle px-3 py-2.5">
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
                      disabled={uploading}
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
                      placeholder="Type a message…"
                      className="flex-1 rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-fg placeholder:text-muted focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/30"
                      disabled={sending}
                    />
                    <button
                      type="submit"
                      disabled={!input.trim() || sending}
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand text-on-accent transition-opacity hover:opacity-90 disabled:opacity-40"
                      aria-label="Send message"
                    >
                      <Send className="h-4 w-4" />
                    </button>
                  </form>
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
