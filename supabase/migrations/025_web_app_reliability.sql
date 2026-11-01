begin;
-- Additive, web-only storage. Apply and test BEFORE enabling WEB_APP_RELIABILITY.
-- No changes to auth, sites, ios_purchases, booking tables, or their policies.
create table public.web_app_drafts (
  user_id uuid not null references auth.users(id) on delete cascade, environment text not null check(environment in ('test','live')),
  draft_id text not null, revision bigint not null check(revision > 0), site_data jsonb not null,
  deployed_url text, published_binding jsonb, latest_intent_id text, publish_lease uuid, lease_until timestamptz,
  suspended boolean not null default false, suspension_reason text check(suspension_reason in ('offline','deleting')), updated_at timestamptz not null default now(),
  primary key(user_id, environment)
);
create table public.web_app_draft_versions (
  user_id uuid not null references auth.users(id) on delete cascade, environment text not null, revision bigint not null,
  draft_id text not null, site_data jsonb not null, created_at timestamptz not null default now(),
  primary key(user_id, environment, revision)
);
create table public.web_app_publish_intents (
  id text primary key, user_id uuid not null references auth.users(id) on delete cascade, environment text not null check(environment in ('test','live')),
  draft_id text not null, revision bigint not null, snapshot jsonb not null, base_version bigint, requires_payment boolean not null default false, worker_token uuid,
  status text not null check(status in ('awaiting_payment','queued','running','failed','live','cancelled','superseded')),
  stripe_session_id text unique, stripe_subscription_id text, attempts integer not null default 0,
  result jsonb, next_attempt_at timestamptz not null default now(), created_at timestamptz not null default now()
);
create index web_app_intents_retry on public.web_app_publish_intents(environment,status,next_attempt_at);
alter table public.web_app_drafts enable row level security;
alter table public.web_app_draft_versions enable row level security;
alter table public.web_app_publish_intents enable row level security;
revoke all on public.web_app_drafts, public.web_app_draft_versions, public.web_app_publish_intents from anon, authenticated;

create function public.archive_web_app_draft() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if TG_OP='INSERT' or NEW.revision <> OLD.revision then
    insert into web_app_draft_versions(user_id,environment,revision,draft_id,site_data)
      values(NEW.user_id,NEW.environment,NEW.revision,NEW.draft_id,NEW.site_data);
    delete from web_app_draft_versions where user_id=NEW.user_id and environment=NEW.environment
      and revision < NEW.revision-19;
  end if;
  return NEW;
end; $$;
revoke all on function public.archive_web_app_draft() from public, anon, authenticated;
create trigger web_app_draft_archive after insert or update on public.web_app_drafts
  for each row execute function public.archive_web_app_draft();

grant all on public.web_app_drafts, public.web_app_draft_versions, public.web_app_publish_intents to service_role;

-- Serialize submission and pointer changes with worker lease acquisition on this account's row.
create function public.submit_web_app_intent(p_user uuid, p_environment text, p_draft text,
  p_revision bigint, p_id text, p_status text, p_base_version bigint, p_snapshot jsonb)
returns setof public.web_app_publish_intents language plpgsql security definer set search_path=public as $$
declare d public.web_app_drafts;
begin
  select * into d from web_app_drafts where user_id=p_user and environment=p_environment for update;
  if not found or d.draft_id<>p_draft or d.revision<>p_revision or (d.suspended and not (d.suspension_reason='offline' and p_status='queued'))
    or (d.publish_lease is not null and d.lease_until>now()) then return; end if;
  insert into web_app_publish_intents(id,user_id,environment,draft_id,revision,snapshot,base_version,status,requires_payment)
    values(p_id,p_user,p_environment,p_draft,p_revision,p_snapshot,p_base_version,p_status,p_status='awaiting_payment')
    on conflict(id) do nothing;
  update web_app_publish_intents set status='superseded'
    where user_id=p_user and environment=p_environment and id<>p_id
      and status in ('awaiting_payment','queued','failed','running');
  update web_app_publish_intents set status=p_status, next_attempt_at=now()
    where id=p_id and status in ('cancelled','superseded');
  update web_app_drafts set latest_intent_id=p_id, suspended=false, suspension_reason=null where user_id=p_user and environment=p_environment;
  return query select * from web_app_publish_intents where id=p_id;
end; $$;
revoke all on function public.submit_web_app_intent(uuid,text,text,bigint,text,text,bigint,jsonb) from public, anon, authenticated;
grant execute on function public.submit_web_app_intent(uuid,text,text,bigint,text,text,bigint,jsonb) to service_role;
commit;
