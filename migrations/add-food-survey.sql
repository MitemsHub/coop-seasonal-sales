-- add-food-survey.sql
-- Pre-cycle Food Distribution item survey.
-- Reps fill a public form (no login) at /survey: name + branch, then price and
-- photo per item. Admins see all submissions in Admin → Food Distribution →
-- Item Survey, and can add entries themselves.
--
-- Three tables:
--   food_survey_catalog   – the surveyable items (name + category), seeded below
--   food_survey_submissions – one per form submission (rep name + branch)
--   food_survey_entries   – one row per item (price + photo), belongs to a submission

CREATE TABLE IF NOT EXISTS food_survey_catalog (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(100) NOT NULL DEFAULT 'Other',
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS food_survey_submissions (
  id BIGSERIAL PRIMARY KEY,
  rep_name VARCHAR(100) NOT NULL,
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  cycle_id INTEGER REFERENCES cycles(id) ON DELETE SET NULL, -- the food cycle this survey targets
  source VARCHAR(20) NOT NULL DEFAULT 'rep' CHECK (source IN ('rep', 'admin')),
  notes TEXT NOT NULL DEFAULT '',
  edit_token TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS food_survey_entries (
  id BIGSERIAL PRIMARY KEY,
  submission_id BIGINT NOT NULL REFERENCES food_survey_submissions(id) ON DELETE CASCADE,
  catalog_id INTEGER REFERENCES food_survey_catalog(id) ON DELETE SET NULL,
  item_name VARCHAR(255) NOT NULL,
  category VARCHAR(100) NOT NULL DEFAULT 'Other',
  price DECIMAL(12,2) NOT NULL CHECK (price >= 0),
  photo_url TEXT, -- nullable: admins may delete an image from an entry
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_food_survey_submissions_branch ON food_survey_submissions(branch_id);
CREATE INDEX IF NOT EXISTS idx_food_survey_submissions_cycle ON food_survey_submissions(cycle_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_food_survey_submissions_token
  ON food_survey_submissions(edit_token) WHERE edit_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_food_survey_submissions_created ON food_survey_submissions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_food_survey_entries_submission ON food_survey_entries(submission_id);

-- ── Upgrade path for a DB created by the earlier version of this script ────
ALTER TABLE food_survey_submissions ADD COLUMN IF NOT EXISTS cycle_id INTEGER REFERENCES cycles(id) ON DELETE SET NULL;
ALTER TABLE food_survey_submissions ADD COLUMN IF NOT EXISTS edit_token TEXT;
CREATE INDEX IF NOT EXISTS idx_food_survey_submissions_cycle ON food_survey_submissions(cycle_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_food_survey_submissions_token
  ON food_survey_submissions(edit_token) WHERE edit_token IS NOT NULL;
ALTER TABLE food_survey_entries ALTER COLUMN photo_url DROP NOT NULL;

-- ── Seed catalog (only when empty, so re-running is safe) ─────────────────
-- Categories follow the grouping used in previous food distribution cycles
-- (Cereals & Grains, Dairy, Staples, Seasonings & Condiments, Oils, Household).
-- Adjust with UPDATE food_survey_catalog SET category = '…' WHERE name = '…';
INSERT INTO food_survey_catalog (name, category, sort_order)
SELECT * FROM (
  VALUES
    ('Oats',                    'Cereals & Grains',       10),
    ('Custard (Checkers)',      'Cereals & Grains',       20),
    ('Cornflakes',              'Cereals & Grains',       30),
    ('Coco pop',                'Cereals & Grains',       40),
    ('Samvita',                 'Cereals & Grains',       50),
    ('Milk Peak (roll/refill)', 'Dairy',                  60),
    ('Milk bag',                'Dairy',                  70),
    ('Rice',                    'Staples',                80),
    ('Noodles',                 'Staples',                90),
    ('Tomato paste/tin',        'Seasonings & Condiments',100),
    ('Knorr Maggi / Gino',      'Seasonings & Condiments',110),
    ('King''s Oil',              'Oils',                   120),
    ('Detergent',               'Household',              130)
) AS v(name, category, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM food_survey_catalog);

-- ── RLS ───────────────────────────────────────────────────────────────────
-- All reads/writes go through the API (service role key), which bypasses RLS.
-- Catalog is publicly readable anyway so the form could load it directly too.
ALTER TABLE food_survey_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_survey_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_survey_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read survey catalog" ON food_survey_catalog;
CREATE POLICY "Public can read survey catalog"
  ON food_survey_catalog FOR SELECT
  USING (TRUE);

-- No policies on submissions/entries → anon clients cannot read or write them
-- directly; only the service role (API routes) touches them.

-- ── Storage bucket for item photos ────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('food-survey', 'food-survey', TRUE)
ON CONFLICT (id) DO UPDATE SET public = TRUE;
