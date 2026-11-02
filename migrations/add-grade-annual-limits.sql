-- migrations/add-grade-annual-limits.sql
-- Annual limits per grade — the ceiling the Exhibition lends against.
-- global_limit stays as the loan ceiling for Food and the global limits;
-- annual_limit is the member's yearly amount, seeded from the figures supplied
-- by operations.
--
-- Safe to re-run: it only adds the column and re-applies the supplied values.

alter table grade_limits add column if not exists annual_limit bigint not null default 0;

update grade_limits g
set annual_limit = v.amount
from (values
  ('Deputy Governor', 0),
  ('Director', 15000000),
  ('Deputy Director', 13400000),
  ('Assistant Director', 12400000),
  ('Principal Manager', 11000000),
  ('Senior Manager', 10000000),
  ('Manager', 7840000),
  ('Deputy Manager', 6720000),
  ('Assistant Manager', 5600000),
  ('Senior Supervisor 1', 3920000),
  ('Senior Supervisor 2', 3360000),
  ('Supervisor', 2688000),
  ('Senior Clerk', 2240000),
  ('Treasury Assistant', 1120000),
  ('Clerk', 1344000),
  ('Treasury Assistant 1', 1120000),
  ('Drivers', 1792000),
  ('Pensioner', 0),
  ('Retiree', 0),
  ('Coop Staff', 0),
  ('Undefined', 0)
) as v(grade, amount)
where lower(g.grade) = lower(v.grade);
