-- migrations/add-exhibition-product-images.sql
-- Vendors may upload more than one photo for a product. The first photo is the
-- cover (and is mirrored into image_url so the cart, orders and invoices keep
-- working unchanged); the rest drive the shop carousel and the view popup.
-- Safe to run more than once.

ALTER TABLE exhibition_products
  ADD COLUMN IF NOT EXISTS image_urls JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN exhibition_products.image_urls IS
  'Ordered list of product photo URLs. image_url always mirrors the first entry.';

-- Products that had a photo before this migration get it into the list, so the
-- trigger below can treat image_urls as the single source of truth without
-- blanking photos that only image_url holds.
UPDATE exhibition_products
   SET image_urls = jsonb_build_array(image_url)
 WHERE image_url <> ''
   AND (image_urls IS NULL OR image_urls = '[]'::jsonb);

-- One writer (the admin photo edit) used to change only image_url, leaving the
-- old cover at the front of image_urls, so the shop carousel kept showing the
-- previous picture. This trigger makes the pair impossible to desync: whatever
-- writes either column, image_url ends up as the first entry of the list.
--
-- A writer that sets only image_url (an older client, or a future route that
-- forgets the list) is still honoured: its photo is promoted to the front
-- instead of being silently overwritten by the stale one.
CREATE OR REPLACE FUNCTION exhibition_products_sync_cover()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  covers jsonb;
  rest jsonb;
BEGIN
  covers := CASE
    WHEN jsonb_typeof(NEW.image_urls) = 'array' THEN NEW.image_urls
    ELSE '[]'::jsonb
  END;

  IF coalesce(NEW.image_url, '') <> ''
     AND coalesce(NEW.image_url, '') <> coalesce(covers->>0, '')
     AND (TG_OP = 'INSERT' OR coalesce(NEW.image_url, '') IS DISTINCT FROM coalesce(OLD.image_url, ''))
  THEN
    SELECT coalesce(jsonb_agg(elem), '[]'::jsonb)
      INTO rest
      FROM jsonb_array_elements(covers) AS elem
     WHERE elem <> to_jsonb(NEW.image_url);
    covers := jsonb_build_array(NEW.image_url) || rest;
  END IF;

  NEW.image_urls := covers;
  NEW.image_url := coalesce(covers->>0, '');
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION exhibition_products_sync_cover() IS
  'Keeps exhibition_products.image_url equal to the first entry of image_urls.';

DROP TRIGGER IF EXISTS trg_exhibition_products_sync_cover ON exhibition_products;
CREATE TRIGGER trg_exhibition_products_sync_cover
BEFORE INSERT OR UPDATE OF image_url, image_urls ON exhibition_products
FOR EACH ROW EXECUTE FUNCTION exhibition_products_sync_cover();
