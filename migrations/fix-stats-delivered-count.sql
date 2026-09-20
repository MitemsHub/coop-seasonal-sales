-- Fix: Count delivered orders from all 3 modules (food, ram, exhibition)
-- The previous query only counted from the `orders` table (food module).

-- No schema change needed — just a query fix in the API route.
-- This migration is a no-op but documents the intent.
-- The actual fix is in app/api/public/stats/route.js.
