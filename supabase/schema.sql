-- =====================================================================
--  업무 로드맵 뷰어 — Supabase 스키마 v2 (Asana 동기화 + 버전 관리)
-- =====================================================================
--  실행: Supabase 대시보드 > SQL Editor 에 전체 붙여넣고 RUN.
--
--  모델:
--   - Asana에서 데이터를 가져올 때마다 report_versions 에 새 버전 1개가
--     스냅샷(JSON)으로 저장됩니다. (= 버전 파일 관리)
--   - groups / project_meta 는 버전과 무관하게 유지되는 "수동 묶음 레이어".
--     (상위 묶음 그룹, 프로젝트→그룹 배정, 색상)  → Asana gid 기준으로 연결.
--
--  보안:
--   - 모든 테이블 RLS 완전 잠금 → anon 키로 직접 접근 불가.
--   - 모든 RPC 는 첫 인자 비밀번호를 서버에서 bcrypt 검증한 뒤 동작.
--   - Asana 토큰은 DB/브라우저가 아니라 Edge Function secret 에 보관.
-- =====================================================================

create extension if not exists pgcrypto;
set search_path = public, extensions;

-- ── 1. 테이블 ────────────────────────────────────────────────────────

-- 상위 묶음(그룹) — 수동, 버전 무관
create table if not exists public.groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,                 -- 홈(정의·설명) 페이지용 그룹 설명
  color       text default '#6366f1',
  sort_order  int  default 0,
  created_at  timestamptz default now()
);
-- 기존 DB 보강
alter table public.groups add column if not exists description text;

-- 프로젝트 수동 메타 (Asana gid 기준) — 그룹 배정/색상, 버전 무관
create table if not exists public.project_meta (
  asana_gid    text primary key,
  name         text,                 -- Asana 원본 이름 캐시(동기화 시 갱신)
  display_name text,                 -- 표시용 이름 오버라이드(비면 name 사용, 동기화가 덮어쓰지 않음)
  description  text,                 -- 홈(정의·설명) 페이지용 프로젝트 설명
  group_id     uuid references public.groups(id) on delete set null,
  color        text,
  sort_order   int default 0,
  updated_at   timestamptz default now()
);
-- 기존 DB 보강
alter table public.project_meta add column if not exists display_name text;
alter table public.project_meta add column if not exists description  text;
alter table public.project_meta add column if not exists icon_url     text;  -- 업로드된 로고 이미지 URL(없으면 기본 문서 아이콘)

-- 버전 (Asana 스냅샷)
create table if not exists public.report_versions (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,        -- 예: "2026-W27" 또는 "6월 4주차"
  note        text,
  source      text default 'asana',
  payload     jsonb not null,       -- { projects:[ { gid,name,...,sections:[ {gid,name,tasks:[...]} ] } ] }
  summary     jsonb,                -- { projects, sections, tasks, completed }
  created_at  timestamptz default now()
);
create index if not exists report_versions_created_idx on public.report_versions (created_at desc);

-- 접근 비밀번호(해시) — 단일 행
create table if not exists public.app_secrets (
  id            int primary key default 1,
  password_hash text not null,
  constraint app_secrets_single_row check (id = 1)
);

-- ── 2. RLS: 전부 잠금 ────────────────────────────────────────────────
alter table public.groups          enable row level security;
alter table public.project_meta    enable row level security;
alter table public.report_versions enable row level security;
alter table public.app_secrets     enable row level security;

-- ── 3. 비밀번호 검증 ─────────────────────────────────────────────────
create or replace function public.check_password(p_password text)
returns boolean language sql security definer set search_path = public, extensions
as $$
  select exists (
    select 1 from public.app_secrets
    where id = 1 and password_hash = crypt(p_password, password_hash)
  );
$$;

create or replace function public.verify_access(p_password text)
returns boolean language sql security definer set search_path = public, extensions
as $$ select public.check_password(p_password); $$;

-- ── 4. 버전 목록 (가벼움, payload 제외) ──────────────────────────────
create or replace function public.list_versions(p_password text)
returns json language plpgsql security definer set search_path = public, extensions
as $$
begin
  if not public.check_password(p_password) then raise exception 'invalid_password'; end if;
  return (
    select coalesce(json_agg(json_build_object(
      'id', v.id, 'label', v.label, 'note', v.note,
      'summary', v.summary, 'created_at', v.created_at
    ) order by v.created_at desc), '[]'::json)
    from public.report_versions v
  );
end;
$$;

-- ── 5. 특정(또는 최신) 버전 + 수동 레이어 조회 ───────────────────────
create or replace function public.get_roadmap(p_password text, p_version_id uuid default null)
returns json language plpgsql security definer set search_path = public, extensions
as $$
declare v public.report_versions%rowtype;
begin
  if not public.check_password(p_password) then raise exception 'invalid_password'; end if;

  if p_version_id is null then
    select * into v from public.report_versions order by created_at desc limit 1;
  else
    select * into v from public.report_versions where id = p_version_id;
  end if;

  return json_build_object(
    'version', case when v.id is null then null else
      json_build_object('id', v.id, 'label', v.label, 'note', v.note,
                        'summary', v.summary, 'created_at', v.created_at) end,
    'payload', coalesce(v.payload, json_build_object('projects', '[]'::json)::jsonb),
    'groups', (select coalesce(json_agg(g order by g.sort_order, g.created_at), '[]'::json) from public.groups g),
    'project_meta', (select coalesce(json_agg(m), '[]'::json) from public.project_meta m)
  );
end;
$$;

-- ── 6. 버전 생성 (Edge Function 이 호출) ─────────────────────────────
create or replace function public.create_version(
  p_password text, p_label text, p_note text, p_payload jsonb, p_summary jsonb
) returns json language plpgsql security definer set search_path = public, extensions
as $$
declare v_id uuid; proj jsonb;
begin
  if not public.check_password(p_password) then raise exception 'invalid_password'; end if;

  insert into public.report_versions (label, note, payload, summary)
  values (coalesce(nullif(p_label,''), to_char(now(), 'YYYY-MM-DD HH24:MI')),
          p_note, p_payload, p_summary)
  returning id into v_id;

  -- 새로 등장한 프로젝트는 project_meta 에 자동 등록(이름 갱신). 기존 그룹/색은 유지.
  for proj in select * from jsonb_array_elements(p_payload->'projects') loop
    insert into public.project_meta (asana_gid, name)
    values (proj->>'gid', proj->>'name')
    on conflict (asana_gid) do update set name = excluded.name, updated_at = now();
  end loop;

  return json_build_object('id', v_id);
end;
$$;

create or replace function public.delete_version(p_password text, p_id uuid)
returns void language plpgsql security definer set search_path = public, extensions
as $$
begin
  if not public.check_password(p_password) then raise exception 'invalid_password'; end if;
  delete from public.report_versions where id = p_id;
end;
$$;

-- ── 7. 그룹 CRUD ─────────────────────────────────────────────────────
create or replace function public.upsert_group(p_password text, p_group jsonb)
returns json language plpgsql security definer set search_path = public, extensions
as $$
declare v_id uuid;
begin
  if not public.check_password(p_password) then raise exception 'invalid_password'; end if;
  if (p_group->>'id') is null or (p_group->>'id') = '' then
    insert into public.groups (name, description, color, sort_order)
    values (p_group->>'name', p_group->>'description', coalesce(p_group->>'color','#6366f1'),
            coalesce((p_group->>'sort_order')::int, 0))
    returning id into v_id;
  else
    update public.groups set
      name = coalesce(p_group->>'name', name),
      description = case when p_group ? 'description' then p_group->>'description' else description end,
      color = coalesce(p_group->>'color', color),
      sort_order = coalesce((p_group->>'sort_order')::int, sort_order)
    where id = (p_group->>'id')::uuid
    returning id into v_id;
  end if;
  return json_build_object('id', v_id);
end;
$$;

create or replace function public.delete_group(p_password text, p_id uuid)
returns void language plpgsql security definer set search_path = public, extensions
as $$
begin
  if not public.check_password(p_password) then raise exception 'invalid_password'; end if;
  delete from public.groups where id = p_id;  -- project_meta.group_id 는 set null
end;
$$;

-- ── 8. 프로젝트 수동 메타 설정(그룹 배정/색상/날짜) ──────────────────
-- project_meta 에 날짜 컬럼 추가 (없으면)
alter table public.project_meta
  add column if not exists start_on date,
  add column if not exists due_on   date;

create or replace function public.set_project_meta(p_password text, p_gid text, p_patch jsonb)
returns void language plpgsql security definer set search_path = public, extensions
as $$
begin
  if not public.check_password(p_password) then raise exception 'invalid_password'; end if;
  insert into public.project_meta (asana_gid, name, display_name, description, group_id, color, sort_order, start_on, due_on, icon_url)
  values (
    p_gid,
    p_patch->>'name',
    nullif(p_patch->>'display_name',''),
    p_patch->>'description',
    nullif(p_patch->>'group_id','')::uuid,
    p_patch->>'color',
    coalesce((p_patch->>'sort_order')::int, 0),
    nullif(p_patch->>'start_on','')::date,
    nullif(p_patch->>'due_on','')::date,
    nullif(p_patch->>'icon_url','')
  )
  on conflict (asana_gid) do update set
    name         = case when p_patch ? 'name'         then p_patch->>'name'                        else public.project_meta.name         end,
    display_name = case when p_patch ? 'display_name' then nullif(p_patch->>'display_name','')      else public.project_meta.display_name end,
    description  = case when p_patch ? 'description'  then p_patch->>'description'                  else public.project_meta.description  end,
    group_id     = case when p_patch ? 'group_id'     then nullif(p_patch->>'group_id','')::uuid    else public.project_meta.group_id     end,
    color        = case when p_patch ? 'color'        then p_patch->>'color'                        else public.project_meta.color        end,
    sort_order   = case when p_patch ? 'sort_order'   then (p_patch->>'sort_order')::int            else public.project_meta.sort_order   end,
    start_on     = case when p_patch ? 'start_on'    then nullif(p_patch->>'start_on','')::date    else public.project_meta.start_on     end,
    due_on       = case when p_patch ? 'due_on'      then nullif(p_patch->>'due_on','')::date      else public.project_meta.due_on       end,
    icon_url     = case when p_patch ? 'icon_url'    then nullif(p_patch->>'icon_url','')          else public.project_meta.icon_url     end,
    updated_at   = now();
end;
$$;

-- ── 8b. 섹션 수동 메타 (날짜 오버라이드) ────────────────────────────
create table if not exists public.section_meta (
  asana_gid  text primary key,
  name       text,
  start_on   date,
  due_on     date,
  updated_at timestamptz default now()
);
alter table public.section_meta enable row level security;

create or replace function public.set_section_meta(p_password text, p_gid text, p_patch jsonb)
returns void language plpgsql security definer set search_path = public, extensions
as $$
begin
  if not public.check_password(p_password) then raise exception 'invalid_password'; end if;
  insert into public.section_meta (asana_gid, name, start_on, due_on)
  values (
    p_gid,
    p_patch->>'name',
    nullif(p_patch->>'start_on','')::date,
    nullif(p_patch->>'due_on','')::date
  )
  on conflict (asana_gid) do update set
    name       = case when p_patch ? 'name'     then p_patch->>'name'                     else public.section_meta.name     end,
    start_on   = case when p_patch ? 'start_on' then nullif(p_patch->>'start_on','')::date else public.section_meta.start_on end,
    due_on     = case when p_patch ? 'due_on'   then nullif(p_patch->>'due_on','')::date   else public.section_meta.due_on   end,
    updated_at = now();
end;
$$;

-- ── 8c. 프로젝트 아이콘 Storage 버킷 ──────────────────────────────────
-- 업로드/삭제는 project-icon Edge Function이 service role 키로 수행(RLS 우회) → 별도 storage 정책 불필요.
-- public 버킷이므로 읽기는 anon 키/비로그인 상태에서도 공개 URL로 가능.
insert into storage.buckets (id, name, public)
values ('project-icons', 'project-icons', true)
on conflict (id) do update set public = true;

-- ── 5. get_roadmap 재정의 (section_meta 포함) ────────────────────────
create or replace function public.get_roadmap(p_password text, p_version_id uuid default null)
returns json language plpgsql security definer set search_path = public, extensions
as $$
declare v public.report_versions%rowtype;
begin
  if not public.check_password(p_password) then raise exception 'invalid_password'; end if;

  if p_version_id is null then
    select * into v from public.report_versions order by created_at desc limit 1;
  else
    select * into v from public.report_versions where id = p_version_id;
  end if;

  return json_build_object(
    'version', case when v.id is null then null else
      json_build_object('id', v.id, 'label', v.label, 'note', v.note,
                        'summary', v.summary, 'created_at', v.created_at) end,
    'payload',      coalesce(v.payload, json_build_object('projects', '[]'::json)::jsonb),
    'groups',       (select coalesce(json_agg(g order by g.sort_order, g.created_at), '[]'::json) from public.groups g),
    'project_meta', (select coalesce(json_agg(m), '[]'::json) from public.project_meta m),
    'section_meta', (select coalesce(json_agg(sm), '[]'::json) from public.section_meta sm)
  );
end;
$$;

-- ── 9. 실행 권한 ─────────────────────────────────────────────────────
grant execute on function public.verify_access(text)                            to anon, authenticated;
grant execute on function public.list_versions(text)                            to anon, authenticated;
grant execute on function public.get_roadmap(text, uuid)                        to anon, authenticated;
grant execute on function public.create_version(text, text, text, jsonb, jsonb) to anon, authenticated;
grant execute on function public.delete_version(text, uuid)                     to anon, authenticated;
grant execute on function public.upsert_group(text, jsonb)                      to anon, authenticated;
grant execute on function public.delete_group(text, uuid)                       to anon, authenticated;
grant execute on function public.set_project_meta(text, text, jsonb)            to anon, authenticated;
grant execute on function public.set_section_meta(text, text, jsonb)            to anon, authenticated;
revoke execute on function public.check_password(text) from anon, authenticated;

-- =====================================================================
--  ★★★ 10. 접근 비밀번호 설정 (여기서 비밀번호를 정합니다) ★★★
-- =====================================================================
insert into public.app_secrets (id, password_hash)
values (1, crypt('CHANGE_ME_강력한비밀번호', gen_salt('bf')))
on conflict (id) do update set password_hash = excluded.password_hash;
-- =====================================================================
