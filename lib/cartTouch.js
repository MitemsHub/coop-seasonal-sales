// lib/cartTouch.js — per-module "last cart touched" stamps.
// Each shop stamps `cartTouch_<module>_<memberId>` whenever its cart is
// saved, so My Coop's continue-shopping banner can surface the most
// recently used non-empty cart across Food, Ram, and Exhibition.
export const CART_TOUCH_KEY = (module, memberId) => `cartTouch_${module}_${memberId}`

export function touchCart(module, memberId) {
  if (!module || !memberId) return
  try {
    localStorage.setItem(CART_TOUCH_KEY(module, memberId), String(Date.now()))
  } catch {
    // Best-effort — a failed stamp just means the banner falls back.
  }
}

export function getCartTouch(module, memberId) {
  if (!memberId) return 0
  try {
    return Number(localStorage.getItem(CART_TOUCH_KEY(module, memberId)) || 0)
  } catch {
    return 0
  }
}
