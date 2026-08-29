-- Promote an existing auth user to admin.
--
-- There is deliberately no in-app way to do this. The `admin-users` Edge
-- Function hardcodes `role: 'gs'`, so an admin account can only be made by
-- someone holding the database -- which is the point: an admin can read every
-- project, reveal every GS password and delete every deck, so anything that
-- could mint one from inside the app would be the most valuable thing in the
-- product to compromise.
--
-- ─── HOW TO USE ──────────────────────────────────────────────────────────────
--
-- 1. Supabase dashboard → Authentication → Users → Add user →
--    "Create new user".
--      Email:    <username>@app.local        e.g. linh.admin@app.local
--      Password: choose one, and TICK "Auto Confirm User"
--    The email is never sent anywhere: @app.local is not a real domain. It
--    exists only because Supabase Auth requires an email while this product
--    signs in by username (src/auth/AuthProvider.tsx maps one to the other).
--
-- 2. Edit the two values in the block below, and nothing else in this file.
--
-- 3. nvm use 22 && npx supabase db query --linked -f supabase/create_admin.sql
--
-- 4. Read the table it prints: every admin account and whether it can sign in.
--    Then hand over the username and password in person or by a channel the
--    other person already trusts -- never in a repo, a ticket or a chat log.
--
-- No psql meta-commands (\set and friends): the Supabase CLI does not run this
-- through psql, so the values live inside the DO block as ordinary literals.

do $$
declare
  -- ─── EDIT THESE TWO ───────────────────────────────────────────────────────
  v_username  text := 'linh.admin';
  v_full_name text := 'Đoàn Công Linh';
  -- ──────────────────────────────────────────────────────────────────────────

  v_email    text;
  v_user_id  uuid;
  v_existing text;
begin
  v_username := lower(trim(v_username));
  v_email := v_username || '@app.local';

  select id into v_user_id from auth.users where email = v_email;
  if v_user_id is null then
    raise exception
      'Chưa có tài khoản đăng nhập nào cho %. Tạo ở Authentication → Users → Add user (nhớ tick Auto Confirm User) rồi chạy lại file này.',
      v_email;
  end if;

  -- "Already an admin" and "already a GS" need different answers: one is done,
  -- the other is a working account somebody is about to silently hand every
  -- project in the system to.
  select role into v_existing from public.profiles where id = v_user_id;
  if v_existing = 'admin' then
    raise notice '% đã là quản trị viên. Không làm gì.', v_username;
    return;
  end if;
  if v_existing is not null then
    raise exception
      '% đang là tài khoản %. Đổi vai trò của một tài khoản đang dùng sẽ đổi quyền trên mọi thứ nó đã ghi — tạo tài khoản đăng nhập mới thay vì đổi cái này.',
      v_username, v_existing;
  end if;

  if exists (select 1 from public.profiles where username = v_username) then
    raise exception 'Tên đăng nhập % đã có người khác dùng.', v_username;
  end if;

  insert into public.profiles (id, username, full_name, role, active)
  values (v_user_id, v_username, v_full_name, 'admin', true);

  raise notice 'Đã tạo quản trị viên % (%).', v_username, v_full_name;
end $$;

-- Every admin account and whether it can actually sign in.
--
-- Listed rather than filtered to the one just created, for two reasons: it
-- needs no second copy of the username to keep in step with the block above,
-- and knowing how many admin accounts exist is worth a glance every time
-- someone runs this.
--
-- `confirmed` is the one that bites: an unconfirmed user is rejected at login
-- with the same message as a wrong password, so without this it gets found out
-- over a phone call the next morning.
select
  p.username,
  p.full_name,
  p.active,
  u.email_confirmed_at is not null as confirmed,
  p.created_at::date as created,
  case
    when u.email_confirmed_at is null
      then 'CHƯA XÁC NHẬN — Authentication → Users → sửa user → Auto Confirm'
    when not p.active then 'ĐANG TẮT — không đăng nhập được'
    else 'SẴN SÀNG'
  end as status
from public.profiles p
join auth.users u on u.id = p.id
where p.role = 'admin'
order by p.created_at;
