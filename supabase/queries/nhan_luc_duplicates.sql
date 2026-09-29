-- Nhân lực: which names would stop 0037 (NL-06). READ-ONLY -- one SELECT,
-- nothing is written, safe to run against production.
--
-- 0037 makes a person's name unique across the two lists the Nhân lực screen
-- shows as one: GS/Visitor accounts (`profiles`, role gs or viewer) and
-- employees (`employees`). Names compare as `lower(btrim(full_name))`, the
-- rule `employees_name_key` has used since 0032. The migration refuses to
-- install its triggers while any BLOCKING row below exists, and changes
-- nothing when it refuses.
--
--   conflict                     blocks_migration  meaning
--   account_vs_account           true              two or more GS/Visitor accounts, hidden ones included,
--                                                  share the name
--   employee_vs_account          true              an employee shares the name with a GS/Visitor account
--                                                  that is not hidden
--   employee_vs_hidden_account   false             an employee shares the name with hidden accounts only;
--                                                  allowed (a converted person, controller ruling A1) and
--                                                  listed so the admin knows the pair exists
--
-- One row per record involved, so the admin sees which rows to rename. Admin
-- accounts are never part of the rule and never listed. No rows at all means
-- 0037 will apply.
--
-- Run it (owner):
--   npx supabase db query --linked -f supabase/queries/nhan_luc_duplicates.sql
with accounts as (
  select id, username, full_name, role, active, hidden,
         lower(btrim(full_name)) as name_key
  from public.profiles
  where role in ('gs', 'viewer')
),
staff as (
  select id, full_name, active,
         lower(btrim(full_name)) as name_key
  from public.employees
),
account_clash as (
  select name_key
  from accounts
  group by name_key
  having count(*) > 1
),
cross_clash as (
  select s.name_key, bool_or(not a.hidden) as blocks
  from staff s
  join accounts a on a.name_key = s.name_key
  group by s.name_key
),
clash as (
  select name_key, 'account_vs_account'::text as conflict, true as blocks_migration
  from account_clash
  union all
  select name_key,
         case when blocks then 'employee_vs_account' else 'employee_vs_hidden_account' end,
         blocks
  from cross_clash
),
involved as (
  select name_key, 'account'::text as kind, id, full_name, username, role,
         case when hidden then 'Đã ẩn' when active then 'Đang dùng' else 'Đã khoá' end as status
  from accounts
  union all
  select name_key, 'employee', id, full_name, null, null,
         case when active then 'Đang làm' else 'Đã nghỉ' end
  from staff
)
select c.conflict, c.blocks_migration, c.name_key,
       i.kind, i.id, i.full_name, i.username, i.role, i.status
from clash c
join involved i
  on i.name_key = c.name_key
 and (c.conflict <> 'account_vs_account' or i.kind = 'account')
order by c.blocks_migration desc, c.name_key, c.conflict, i.kind, i.username nulls last, i.id;
