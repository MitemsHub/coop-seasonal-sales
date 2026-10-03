-- Migration: add the Unit column to the food survey item catalog.
-- Run once in the Supabase SQL Editor (same as cycle-survey-open.sql).
--
-- Unit = how the item is sold: Bag, Carton, Gallon, Bucket, Crate, Piece …
-- It shows in the admin item list (new "Unit" column) and next to every item
-- on the survey form, so reps know what a price is for.
--
-- Until this has been run the app still works: the catalog simply operates
-- without the column and units cannot be saved yet (the admin API answers
-- with a pointer to this file).

ALTER TABLE food_survey_catalog
  ADD COLUMN IF NOT EXISTS unit VARCHAR(50) NOT NULL DEFAULT '';

COMMENT ON COLUMN food_survey_catalog.unit IS
  'Selling unit for the item (Bag, Carton, Gallon, Piece, …) as shown on the survey form.';

-- Optional: seed units for staples, e.g.
--   UPDATE food_survey_catalog SET unit = 'Bag'
--   WHERE unit = '' AND category = 'Cereals & Grains';
-- Or set them per item from the admin item list's new Unit column.
