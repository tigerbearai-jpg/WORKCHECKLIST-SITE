-- Exact existing schema snapshots from WORKCHECKLIST ea0f9e2; tests only.
-- WORKCHECKLIST Phase 1: empty schema only. No legacy records are imported.
-- All API-exposed tables require Supabase Auth ownership and RLS.

create table if not exists public.legacy_sheet_rows (
  owner_id uuid not null references auth.users(id) on delete cascade,
  app text not null check (app = 'work'),
  sheet_name text not null,
  sheet_row integer not null check (sheet_row >= 1),
  cells jsonb not null check (jsonb_typeof(cells) = 'array'),
  source_imported_at timestamptz not null default now(),
  primary key (owner_id, app, sheet_name, sheet_row)
);
create index if not exists idx_legacy_sheet_rows_lookup
  on public.legacy_sheet_rows (owner_id, app, sheet_name, sheet_row);

-- Work-management core tables.
create table if not exists public.work_categories (
  owner_id uuid not null references auth.users(id) on delete cascade,
  category_name text not null,
  primary key (owner_id, category_name)
);
create table if not exists public.work_projects (
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_name text not null,
  project_status text,
  primary key (owner_id, project_name)
);
create table if not exists public.work_items (
  owner_id uuid not null references auth.users(id) on delete cascade,
  item_id text not null,
  title text not null default '',
  category_name text,
  project_name text,
  project_status text,
  item_status text,
  followup_status text,
  latest_progress text,
  next_step text,
  last_progress_date date,
  next_followup_date date,
  target_date date,
  attention_note text,
  confidence text,
  sop_id text,
  source_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (owner_id, item_id)
);
create index if not exists idx_work_items_due
  on public.work_items (owner_id, next_followup_date, target_date);
create index if not exists idx_work_items_project
  on public.work_items (owner_id, project_name, item_status);
create table if not exists public.work_steps (
  owner_id uuid not null references auth.users(id) on delete cascade,
  step_id text not null,
  item_id text not null,
  ordinal integer not null default 0,
  title text not null default '',
  state text,
  reminders text,
  required_docs text,
  risk_notes text,
  sop_origin text,
  finished_date date,
  source_json jsonb not null default '{}'::jsonb,
  primary key (owner_id, step_id),
  foreign key (owner_id, item_id) references public.work_items (owner_id, item_id) on delete cascade
);
create index if not exists idx_work_steps_item on public.work_steps (owner_id, item_id, ordinal);
create table if not exists public.work_sop_templates (
  owner_id uuid not null references auth.users(id) on delete cascade,
  sop_id text not null,
  template_name text not null default '',
  category_name text,
  keywords text,
  conditions text,
  version text,
  state text,
  source_json jsonb not null default '{}'::jsonb,
  primary key (owner_id, sop_id)
);
create table if not exists public.work_sop_steps (
  owner_id uuid not null references auth.users(id) on delete cascade,
  sop_id text not null,
  ordinal integer not null,
  step_name text not null default '',
  reminders text,
  required_docs text,
  risk_notes text,
  conditions text,
  source_json jsonb not null default '{}'::jsonb,
  primary key (owner_id, sop_id, ordinal),
  foreign key (owner_id, sop_id) references public.work_sop_templates (owner_id, sop_id) on delete cascade
);
create table if not exists public.work_action_logs (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  event_time timestamptz,
  item_id text,
  action text,
  details text,
  step_id text,
  event_date date,
  previous_value text,
  new_value text,
  source_json jsonb not null default '{}'::jsonb
);
create index if not exists idx_work_logs_owner_time
  on public.work_action_logs(owner_id, event_time desc);

-- Explicit Data API grants; ownership policies separately protect every row.
-- Anon has NO privileges on these business tables.
alter table public.legacy_sheet_rows enable row level security;
revoke all on table public.legacy_sheet_rows from anon, authenticated;
grant select, insert, update, delete on table public.legacy_sheet_rows to authenticated;
create policy "legacy_sheet_rows_select_owner" on public.legacy_sheet_rows for select to authenticated using (owner_id = (select auth.uid()));
create policy "legacy_sheet_rows_insert_owner" on public.legacy_sheet_rows for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "legacy_sheet_rows_update_owner" on public.legacy_sheet_rows for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "legacy_sheet_rows_delete_owner" on public.legacy_sheet_rows for delete to authenticated using (owner_id = (select auth.uid()));

alter table public.work_categories enable row level security;
revoke all on table public.work_categories from anon, authenticated;
grant select, insert, update, delete on table public.work_categories to authenticated;
create policy "work_categories_select_owner" on public.work_categories for select to authenticated using (owner_id = (select auth.uid()));
create policy "work_categories_insert_owner" on public.work_categories for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "work_categories_update_owner" on public.work_categories for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "work_categories_delete_owner" on public.work_categories for delete to authenticated using (owner_id = (select auth.uid()));

alter table public.work_projects enable row level security;
revoke all on table public.work_projects from anon, authenticated;
grant select, insert, update, delete on table public.work_projects to authenticated;
create policy "work_projects_select_owner" on public.work_projects for select to authenticated using (owner_id = (select auth.uid()));
create policy "work_projects_insert_owner" on public.work_projects for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "work_projects_update_owner" on public.work_projects for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "work_projects_delete_owner" on public.work_projects for delete to authenticated using (owner_id = (select auth.uid()));

alter table public.work_items enable row level security;
revoke all on table public.work_items from anon, authenticated;
grant select, insert, update, delete on table public.work_items to authenticated;
create policy "work_items_select_owner" on public.work_items for select to authenticated using (owner_id = (select auth.uid()));
create policy "work_items_insert_owner" on public.work_items for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "work_items_update_owner" on public.work_items for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "work_items_delete_owner" on public.work_items for delete to authenticated using (owner_id = (select auth.uid()));

alter table public.work_steps enable row level security;
revoke all on table public.work_steps from anon, authenticated;
grant select, insert, update, delete on table public.work_steps to authenticated;
create policy "work_steps_select_owner" on public.work_steps for select to authenticated using (owner_id = (select auth.uid()));
create policy "work_steps_insert_owner" on public.work_steps for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "work_steps_update_owner" on public.work_steps for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "work_steps_delete_owner" on public.work_steps for delete to authenticated using (owner_id = (select auth.uid()));

alter table public.work_sop_templates enable row level security;
revoke all on table public.work_sop_templates from anon, authenticated;
grant select, insert, update, delete on table public.work_sop_templates to authenticated;
create policy "work_sop_templates_select_owner" on public.work_sop_templates for select to authenticated using (owner_id = (select auth.uid()));
create policy "work_sop_templates_insert_owner" on public.work_sop_templates for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "work_sop_templates_update_owner" on public.work_sop_templates for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "work_sop_templates_delete_owner" on public.work_sop_templates for delete to authenticated using (owner_id = (select auth.uid()));

alter table public.work_sop_steps enable row level security;
revoke all on table public.work_sop_steps from anon, authenticated;
grant select, insert, update, delete on table public.work_sop_steps to authenticated;
create policy "work_sop_steps_select_owner" on public.work_sop_steps for select to authenticated using (owner_id = (select auth.uid()));
create policy "work_sop_steps_insert_owner" on public.work_sop_steps for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "work_sop_steps_update_owner" on public.work_sop_steps for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "work_sop_steps_delete_owner" on public.work_sop_steps for delete to authenticated using (owner_id = (select auth.uid()));

alter table public.work_action_logs enable row level security;
revoke all on table public.work_action_logs from anon, authenticated;
grant select, insert, update, delete on table public.work_action_logs to authenticated;
create policy "work_action_logs_select_owner" on public.work_action_logs for select to authenticated using (owner_id = (select auth.uid()));
create policy "work_action_logs_insert_owner" on public.work_action_logs for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "work_action_logs_update_owner" on public.work_action_logs for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "work_action_logs_delete_owner" on public.work_action_logs for delete to authenticated using (owner_id = (select auth.uid()));

-- Work action logs use an identity column. Allow authenticated inserts to use sequence.
grant usage, select on sequence public.work_action_logs_id_seq to authenticated;
-- Multi-project support for WORKCHECKLIST work items.
-- Keeps legacy work_items.project_name/project_status for backwards compatibility.
-- The new junction table is the source of truth for one work item linked to many projects.

create table if not exists public.work_item_projects (
  owner_id uuid not null references auth.users(id) on delete cascade,
  item_id text not null,
  project_name text not null,
  created_at timestamptz not null default now(),
  constraint work_item_projects_pkey primary key (owner_id, item_id, project_name),
  constraint work_item_projects_item_fkey foreign key (owner_id, item_id)
    references public.work_items(owner_id, item_id) on delete cascade,
  constraint work_item_projects_project_fkey foreign key (owner_id, project_name)
    references public.work_projects(owner_id, project_name) on update cascade on delete restrict
);
create index if not exists work_item_projects_project_idx
  on public.work_item_projects(owner_id, project_name, item_id);

alter table public.work_item_projects enable row level security;
grant select, insert, update, delete on public.work_item_projects to authenticated;

drop policy if exists work_item_projects_select_owner on public.work_item_projects;
create policy work_item_projects_select_owner on public.work_item_projects
  for select to authenticated using ((select auth.uid()) = owner_id);
drop policy if exists work_item_projects_insert_owner on public.work_item_projects;
create policy work_item_projects_insert_owner on public.work_item_projects
  for insert to authenticated with check ((select auth.uid()) = owner_id);
drop policy if exists work_item_projects_update_owner on public.work_item_projects;
create policy work_item_projects_update_owner on public.work_item_projects
  for update to authenticated using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
drop policy if exists work_item_projects_delete_owner on public.work_item_projects;
create policy work_item_projects_delete_owner on public.work_item_projects
  for delete to authenticated using ((select auth.uid()) = owner_id);

-- Promote every legacy project label to the project catalog, without replacing existing project status.
insert into public.work_projects(owner_id, project_name, project_status)
select owner_id, project_name, max(coalesce(nullif(project_status,''),'待确认'))
from public.work_items
where nullif(trim(project_name),'') is not null
group by owner_id, project_name
on conflict (owner_id, project_name) do nothing;

-- Backfill each existing single-project assignment into the junction table.
insert into public.work_item_projects(owner_id, item_id, project_name)
select wi.owner_id, wi.item_id, wi.project_name
from public.work_items wi
join public.work_projects wp
  on wp.owner_id = wi.owner_id and wp.project_name = wi.project_name
where nullif(trim(wi.project_name),'') is not null
on conflict (owner_id, item_id, project_name) do nothing;

-- Keep project renames, merges, and retirement safe with many-to-many links.
create or replace function public.work_taxonomy_manage(
  p_kind text,
  p_action text,
  p_old_name text,
  p_new_name text,
  p_phase text default null
)
returns jsonb
language plpgsql
set search_path to 'pg_catalog', 'public', 'auth'
as $function$
declare
 uid uuid := (select auth.uid());
 old_name text := nullif(trim(coalesce(p_old_name,'')),'');
 new_name text := nullif(trim(coalesce(p_new_name,'')),'');
 old_exists boolean;
 new_exists boolean;
 affected integer := 0;
 is_cat boolean;
begin
 if uid is null then raise exception '请先登录'; end if;
 if p_kind not in ('category','project') then raise exception '管理类型无效'; end if;
 if p_action not in ('add','rename','merge','retire') then raise exception '操作类型无效'; end if;
 is_cat := p_kind='category';

 if is_cat then
  select exists(select 1 from public.work_categories where owner_id=uid and category_name=old_name) into old_exists;
  select exists(select 1 from public.work_categories where owner_id=uid and category_name=new_name) into new_exists;
 else
  select exists(select 1 from public.work_projects where owner_id=uid and project_name=old_name) into old_exists;
  select exists(select 1 from public.work_projects where owner_id=uid and project_name=new_name) into new_exists;
 end if;

 if p_action='add' then
  if new_name is null or new_exists then raise exception '新名称为空或已经存在'; end if;
  if is_cat then
   insert into public.work_categories(owner_id,category_name) values(uid,new_name);
  else
   insert into public.work_projects(owner_id,project_name,project_status) values(uid,new_name,coalesce(p_phase,'筹备'));
  end if;
  return jsonb_build_object('ok',true,'changed',0);
 end if;

 if old_name is null or not old_exists then raise exception '原分类或项目不存在'; end if;

 if p_action='retire' then
  if is_cat then
   if exists(select 1 from public.work_items where owner_id=uid and category_name=old_name)
      or exists(select 1 from public.work_sop_templates where owner_id=uid and category_name=old_name)
   then raise exception '该分类仍有关联工作或SOP，请先合并或重命名'; end if;
   delete from public.work_categories where owner_id=uid and category_name=old_name;
  else
   if exists(select 1 from public.work_items where owner_id=uid and project_name=old_name)
      or exists(select 1 from public.work_item_projects where owner_id=uid and project_name=old_name)
   then raise exception '该项目仍有关联工作，请先合并或重命名'; end if;
   delete from public.work_projects where owner_id=uid and project_name=old_name;
  end if;
  return jsonb_build_object('ok',true,'changed',0);
 end if;

 if new_name is null or new_name=old_name then raise exception '新名称必须不同于原名称'; end if;
 if p_action='rename' and new_exists then raise exception '目标名称已存在，请选择合并'; end if;
 if p_action='merge' and not new_exists then raise exception '合并目标必须是已有名称'; end if;

 if is_cat then
  update public.work_items set category_name=new_name,updated_at=now() where owner_id=uid and category_name=old_name;
  get diagnostics affected = row_count;
  update public.work_sop_templates set category_name=new_name where owner_id=uid and category_name=old_name;
  if p_action='rename' then
   update public.work_categories set category_name=new_name where owner_id=uid and category_name=old_name;
  else
   delete from public.work_categories where owner_id=uid and category_name=old_name;
  end if;
 else
  if p_action='merge' then
   insert into public.work_item_projects(owner_id,item_id,project_name)
   select owner_id,item_id,new_name
   from public.work_item_projects
   where owner_id=uid and project_name=old_name
   on conflict (owner_id,item_id,project_name) do nothing;
   delete from public.work_item_projects where owner_id=uid and project_name=old_name;
  end if;
  update public.work_items set project_name=new_name,updated_at=now() where owner_id=uid and project_name=old_name;
  get diagnostics affected = row_count;
  if p_action='rename' then
   update public.work_projects
   set project_name=new_name,project_status=coalesce(nullif(p_phase,''),project_status)
   where owner_id=uid and project_name=old_name;
  else
   delete from public.work_projects where owner_id=uid and project_name=old_name;
  end if;
 end if;

 insert into public.work_action_logs(owner_id,event_time,action,details,event_date,previous_value,new_value)
 values (uid,now(),case when is_cat then '调整业务分类' else '调整项目名称' end,
 old_name||' → '||new_name,current_date,old_name,new_name);
 return jsonb_build_object('ok',true,'changed',affected);
end;
$function$;
