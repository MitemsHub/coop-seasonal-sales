// lib/supabaseClient.js
import { createClient as _createClient } from '@supabase/supabase-js'

// Get Supabase URL and Key from environment variables
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

// Default client instance (legacy — prefer createClient() factory)
export const supabase = _createClient(supabaseUrl, supabaseAnonKey)

/**
 * Factory that returns a fresh Supabase client.
 * Use this for Realtime subscriptions or when you need a separate client instance.
 */
export function createClient() {
  return _createClient(supabaseUrl, supabaseAnonKey)
}
