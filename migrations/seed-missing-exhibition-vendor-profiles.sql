-- migrations/seed-missing-exhibition-vendor-profiles.sql
-- The written profile seed matched 90 of the 105 cycle-1 stands. These are the
-- 15 it could not match; each now carries a shelf and a one-line pitch so the
-- card never reads "Exhibition stand" and the stand is not left out of a shelf.
--
-- Where a stand has listings, the shelf comes from what it actually sells
-- (BLESSED's turkeys, OG WINNERS' phones, MODA's abayas). Five stands have no
-- listings at all; their shelf is the best reading of the business name and
-- location, and the vendor can change it in the vendor portal.

UPDATE exhibition_vendors SET
  category = 'Solar & Power',
  about = 'Solar panels, hybrid inverters and lithium batteries — complete systems sized for homes and businesses.'
WHERE trim(name) = 'FORTE VISION ENERGY';

UPDATE exhibition_vendors SET
  category = 'Fashion & Fabric',
  about = 'Modest ready-to-wear — abayas, kaftans and occasion gowns cut for everyday elegance.'
WHERE trim(name) = 'MODA BY FAWZA';

UPDATE exhibition_vendors SET
  category = 'Home & Kitchen',
  about = 'Household and everyday goods gathered from Garki International Market.'
WHERE trim(name) = 'OSIMANZE VENTURES';

UPDATE exhibition_vendors SET
  category = 'Fashion & Fabric',
  about = 'Hand-finished kaftans and two-piece sets in bold prints and rich brocade.'
WHERE trim(name) = 'OLLYS COLLECTION';

UPDATE exhibition_vendors SET
  category = 'Home & Kitchen',
  about = 'Gifts, home pieces and lifestyle finds picked from Ado Bayero Hall, Garki.'
WHERE trim(name) = 'JUST IMAGINE INTERNATIONAL LTD';

UPDATE exhibition_vendors SET
  category = 'Drinks & Beverages',
  about = 'Chilled bottled water in 60cl and 75cl packs, delivered from Lugbe.'
WHERE trim(name) = 'MAMA SHADE';

UPDATE exhibition_vendors SET
  category = 'Fashion & Fabric',
  about = 'Clarks shoes and everyday footwear, fitted at the stand.'
WHERE trim(name) = 'GENUINE COLLECTIONS';

UPDATE exhibition_vendors SET
  category = 'Fashion & Fabric',
  about = 'Silk and stone-trimmed occasion pieces made to order in Wuse.'
WHERE trim(name) = 'DEOSEQ ROYAL SIGNATURE';

UPDATE exhibition_vendors SET
  category = 'Meat, Fish & Eggs',
  about = 'Fresh and frozen turkey, seafood and poultry cuts for the season''s table.'
WHERE trim(name) = 'BLESSED SEA FOOD AND FROZEN FOOD ENTERPRISE';

UPDATE exhibition_vendors SET
  category = 'Phones & Electronics',
  about = 'Phones from Infinix, Itel, Vivo, Honor and Poco, with the models in stock today.'
WHERE trim(name) = 'OG WINNERS';

UPDATE exhibition_vendors SET
  category = 'Jewellery & Accessories',
  about = 'Hand-assembled beadwork, coral jewellery and statement earrings on non-tarnish chains.'
WHERE trim(name) = 'BEADS AND CRAFT BY ADOO';

UPDATE exhibition_vendors SET
  category = 'School & Office',
  about = 'Office and stationery essentials for ministries, teams and everyday work.'
WHERE trim(name) = 'EL-JOSHUA GLOBAL SERVICES LIMITED';

UPDATE exhibition_vendors SET
  category = 'Solar & Power',
  about = 'Longi and Jinko solar panels for homes and businesses moving off the grid.'
WHERE trim(name) = 'LEONS TECH SOLAR ENGINEERING LIMITED';

UPDATE exhibition_vendors SET
  category = 'Home & Kitchen',
  about = 'Home and lifestyle goods from Wuse 2, chosen for everyday use.'
WHERE trim(name) = 'IZE-HALIFFASS GLOBAL RESOURCES';

UPDATE exhibition_vendors SET
  category = 'Fashion & Fabric',
  about = 'Fashion and occasion pieces presented at Silver Bird Galleria, Central Area.'
WHERE trim(name) = 'HOUSE OF TERGAN';
