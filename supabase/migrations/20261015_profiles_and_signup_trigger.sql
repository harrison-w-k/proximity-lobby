-- Applied to Supabase project ufmoyhmjqlfugnxkeqfs (proximity-lobby) as "profiles_and_signup_trigger".

-- One profile per verified user. The username is what other players see in the lobby.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  created_at timestamptz not null default now(),
  constraint profiles_username_format check (username ~ '^[a-z0-9._-]{1,16}$')
);

-- Usernames are unique regardless of case.
create unique index profiles_username_lower_key on public.profiles (lower(username));

alter table public.profiles enable row level security;

-- Signed-in players can see each other's usernames; nobody else can read profiles.
create policy "profiles are readable by signed-in users"
  on public.profiles for select to authenticated
  using (true);

-- Players can change only their own profile. There is deliberately no insert or delete
-- policy: rows are created by the trigger below and removed with the auth user.
create policy "users can update their own profile"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Create the profile on first sign-in: the part of the email before "@", lowercased,
-- "+tag" removed, sanitised, max 16 chars (same rules as the old client), numbered if taken.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  base text;
  candidate text;
  suffix text;
  n int := 1;
begin
  base := lower(split_part(split_part(coalesce(new.email, ''), '@', 1), '+', 1));
  base := left(regexp_replace(base, '[^a-z0-9._-]', '', 'g'), 16);
  if base = '' then
    base := 'player';
  end if;

  loop
    suffix := case when n = 1 then '' else '_' || n::text end;
    candidate := left(base, 16 - length(suffix)) || suffix;
    begin
      insert into public.profiles (id, username) values (new.id, candidate);
      return new;
    exception when unique_violation then
      n := n + 1;
      if n > 1000 then
        raise;
      end if;
    end;
  end loop;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
