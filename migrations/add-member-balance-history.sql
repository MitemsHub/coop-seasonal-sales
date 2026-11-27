-- migrations/add-member-balance-history.sql
-- Savings and loan balances used to change with no record beyond members.updated_at
-- (and, once, a one-off backup table). Every balance change now writes a row
-- here with the old and new values, who made it, where it came from and when,
-- so the app can show the trail per member.
--
-- Written by the app (Members settings, bulk member import) through
-- lib/memberBalanceHistory.js. RLS is on with no policies so only the
-- service-role client can read or write it.
CREATE TABLE IF NOT EXISTS member_balance_history (
  id BIGSERIAL PRIMARY KEY,
  member_id VARCHAR NOT NULL,
  old_savings NUMERIC(16, 2),
  new_savings NUMERIC(16, 2),
  old_loans NUMERIC(16, 2),
  new_loans NUMERIC(16, 2),
  source TEXT NOT NULL DEFAULT 'Members settings',
  changed_by TEXT NOT NULL DEFAULT 'admin',
  note TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_member_balance_history_member
  ON member_balance_history(member_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_member_balance_history_changed_at
  ON member_balance_history(changed_at DESC);

ALTER TABLE member_balance_history ENABLE ROW LEVEL SECURITY;

-- Fold the one-off 27 Nov sheet upload into the trail so those changes are
-- visible in the app too. Guarded: the backup table only exists where the
-- upload was run.
DO $$
BEGIN
  IF to_regclass('public.member_balance_backup_20261127') IS NOT NULL THEN
    INSERT INTO member_balance_history
      (member_id, old_savings, new_savings, old_loans, new_loans, source, changed_by, note, changed_at)
    SELECT b.member_id,
           b.savings,
           m.savings,
           b.loans,
           m.loans,
           'UPDATED MEMBERS BAL.xlsx (bulk sheet)',
           'admin',
           'Balance sheet upload',
           b.backed_up_at
    FROM member_balance_backup_20261127 b
    JOIN members m ON m.member_id = b.member_id
    WHERE b.savings IS DISTINCT FROM m.savings
       OR b.loans IS DISTINCT FROM m.loans
       OR b.savings IS DISTINCT FROM m.savings;
  END IF;
END
$$;
