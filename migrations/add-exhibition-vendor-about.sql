-- Stand profiles: what a stand sells, and the line members read about it.
--
-- `category` is the vendor's declared category from the participation form —
-- the shop uses it to shelve the stand's products (a fashion stand's gowns stay
-- in Fashion, even when a product is called "Turkey gown").
-- `about` is the stand's one-line pitch, shown on the stand card and page.
-- Both are editable by the vendor at /vendor/stand and by an admin from
-- Admin → Exhibition → Vendors.
--
-- Safe to re-run.

ALTER TABLE exhibition_vendors
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS about TEXT NOT NULL DEFAULT '';
