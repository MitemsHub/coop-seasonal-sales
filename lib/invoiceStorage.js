// app/lib/invoiceStorage.js
// Shared invoice file storage: Supabase Storage first, with a local filesystem
// fallback (public/uploads/…) for fresh/dev Supabase instances that have no
// storage provisioned — the same pattern the product-image route uses. All
// invoice routes (vendor + admin exhibition) share this so behaviour stays
// consistent. Rows store `storage_bucket` ('vendor-invoices' | 'local') and
// `storage_path`; URLs are signed for storage rows and direct for local rows.
import { writeFile, mkdir, unlink } from 'fs/promises'
import { join, dirname } from 'path'

export const INVOICE_BUCKET = 'vendor-invoices'

// Uploads a buffer, returns { storage_bucket, storage_path, url }.
// `path` is the storage path (e.g. `exhibition/1/2026-08-16/…`); `publicPrefix`
// names the local fallback folder (e.g. `invoices/1`).
export async function uploadInvoiceFile(supabase, { path, publicPrefix, buffer, mime }) {
  try {
    const { data: bucketInfo, error: bucketInfoErr } = await supabase.storage.getBucket(INVOICE_BUCKET)
    if (bucketInfoErr || !bucketInfo) {
      await supabase.storage.createBucket(INVOICE_BUCKET, { public: false })
    }
    const { error: upErr } = await supabase.storage
      .from(INVOICE_BUCKET)
      .upload(path, buffer, { contentType: mime, upsert: false })
    if (!upErr) {
      const { data: urlData } = await supabase.storage.from(INVOICE_BUCKET).createSignedUrl(path, 60 * 60)
      return { storage_bucket: INVOICE_BUCKET, storage_path: path, url: urlData?.signedUrl || null }
    }
    console.warn('Invoice storage upload failed, using local fallback:', upErr?.message)
  } catch (e) {
    console.warn('Invoice storage unavailable, using local fallback:', e?.message)
  }

  // Local filesystem fallback (development) — served from /uploads/…
  const rel = `${publicPrefix}/${new Date().toISOString().slice(0, 10)}/${Date.now()}_${String(path.split('/').pop() || 'file')}`
  const abs = join(process.cwd(), 'public', 'uploads', rel)
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, buffer)
  return { storage_bucket: 'local', storage_path: rel, url: `/uploads/${rel}` }
}

// Resolves a stored row to its viewable URL (signed for storage, direct for local).
export async function invoiceFileUrl(supabase, inv) {
  if (!inv) return null
  if (String(inv.storage_bucket || '') === 'local') {
    const rel = String(inv.storage_path || '')
    return rel ? `/uploads/${rel}` : null
  }
  const bucket = String(inv.storage_bucket || '')
  const path = String(inv.storage_path || '')
  if (!bucket || !path) return null
  const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60)
  return data?.signedUrl || null
}

// Removes a stored file (storage or local fallback). Best-effort.
export async function removeInvoiceFile(supabase, inv) {
  if (!inv) return
  if (String(inv.storage_bucket || '') === 'local') {
    const rel = String(inv.storage_path || '')
    if (rel) await unlink(join(process.cwd(), 'public', 'uploads', rel)).catch(() => null)
    return
  }
  const bucket = String(inv.storage_bucket || '')
  const path = String(inv.storage_path || '')
  if (bucket && path) await supabase.storage.from(bucket).remove([path]).catch(() => null)
}
