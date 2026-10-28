-- Apply to the existing Supabase schema after 202610260009, before publishing
-- the matching frontend. Additive only: no records or existing columns removed.
begin;
alter table public.work_categories add column if not exists is_active boolean not null default true;
alter table public.work_projects add column if not exists is_active boolean not null default true;
alter table public.work_items add column if not exists category_names text[] not null default '{}';
alter table public.work_items add column if not exists notes text;
-- Preserve each original category as ONE name, including punctuation.
update public.work_items set category_names=array[category_name]
where cardinality(category_names)=0 and nullif(category_name,'') is not null;

create or replace function public.work_taxonomy_manage(
 p_kind text,p_action text,p_old_name text,p_new_name text,p_phase text default null
) returns jsonb language plpgsql security invoker
set search_path = pg_catalog, public, auth as $$
declare
 uid uuid := (select auth.uid());
 old_name text:=nullif(trim(coalesce(p_old_name,'')),'');
 new_name text:=nullif(trim(coalesce(p_new_name,'')),'');
 old_exists boolean;
 new_exists boolean;
 target_active boolean;
 affected integer:=0;
 is_cat boolean;
begin
 if uid is null then raise exception '请先登录'; end if;
 if p_kind is null or p_kind not in ('category','project') then raise exception '管理类型无效'; end if;
 if p_action is null or p_action not in ('add','rename','merge','retire','disable','enable','phase') then raise exception '操作类型无效'; end if;
 is_cat:=p_kind='category';
 if is_cat then
  select exists(select 1 from public.work_categories where owner_id=uid and category_name=old_name) into old_exists;
  select exists(select 1 from public.work_categories where owner_id=uid and category_name=new_name) into new_exists;
  select is_active into target_active from public.work_categories where owner_id=uid and category_name=new_name;
 else
  select exists(select 1 from public.work_projects where owner_id=uid and project_name=old_name) into old_exists;
  select exists(select 1 from public.work_projects where owner_id=uid and project_name=new_name) into new_exists;
  select is_active into target_active from public.work_projects where owner_id=uid and project_name=new_name;
 end if;
 if p_action='add' then
  if new_name is null or new_exists then raise exception '新名称为空或已经存在'; end if;
  if is_cat then insert into public.work_categories(owner_id,category_name) values(uid,new_name);
  else insert into public.work_projects(owner_id,project_name,project_status) values(uid,new_name,coalesce(nullif(p_phase,''),'筹备')); end if;
 elsif old_name is null or not old_exists then raise exception '原分类或项目不存在';
 elsif p_action in ('disable','enable') then
  if is_cat then update public.work_categories set is_active=(p_action='enable') where owner_id=uid and category_name=old_name;
  else update public.work_projects set is_active=(p_action='enable') where owner_id=uid and project_name=old_name; end if;
 elsif p_action='phase' then
  if is_cat or p_phase is null or p_phase not in ('在营','筹备','平台','待确认') then raise exception '项目状态无效'; end if;
  update public.work_projects set project_status=p_phase where owner_id=uid and project_name=old_name;
  update public.work_items set project_status=p_phase,updated_at=now() where owner_id=uid and project_name=old_name;
  select count(*) into affected from public.work_items w where w.owner_id=uid and
   (w.project_name=old_name or exists(select 1 from public.work_item_projects p where p.owner_id=uid and p.item_id=w.item_id and p.project_name=old_name));
 elsif p_action='retire' then
  if is_cat then
   if exists(select 1 from public.work_items where owner_id=uid and (category_name=old_name or old_name=any(category_names)))
    or exists(select 1 from public.work_sop_templates where owner_id=uid and category_name=old_name)
   then raise exception '该分类仍有关联工作或SOP，请先合并或停用'; end if;
   delete from public.work_categories where owner_id=uid and category_name=old_name;
  else
   if exists(select 1 from public.work_items where owner_id=uid and project_name=old_name)
    or exists(select 1 from public.work_item_projects where owner_id=uid and project_name=old_name)
   then raise exception '该项目仍有关联工作，请先合并或停用'; end if;
   delete from public.work_projects where owner_id=uid and project_name=old_name;
  end if;
 else
  if new_name is null or new_name=old_name then raise exception '新名称必须不同于原名称'; end if;
  if p_action='rename' and new_exists then raise exception '目标名称已存在，请选择合并'; end if;
  if p_action='merge' and (not new_exists or not target_active) then raise exception '合并目标必须是启用的已有名称'; end if;
  if is_cat then
   update public.work_items w set
    category_name=case when category_name=old_name then new_name else category_name end,
    category_names=array(select value from (
     select case when name=old_name then new_name else name end as value,min(ord) as position
     from unnest(case when cardinality(w.category_names)>0 then w.category_names else array[w.category_name] end) with ordinality as n(name,ord)
     where name is not null group by case when name=old_name then new_name else name end
    ) names order by position),updated_at=now()
   where owner_id=uid and (category_name=old_name or old_name=any(category_names));
   get diagnostics affected=row_count;
   update public.work_sop_templates set category_name=new_name where owner_id=uid and category_name=old_name;
   if p_action='rename' then update public.work_categories set category_name=new_name where owner_id=uid and category_name=old_name;
   else delete from public.work_categories where owner_id=uid and category_name=old_name; end if;
  else
   select count(*) into affected from public.work_items w where w.owner_id=uid and
    (w.project_name=old_name or exists(select 1 from public.work_item_projects p where p.owner_id=uid and p.item_id=w.item_id and p.project_name=old_name));
   if p_action='merge' then
    insert into public.work_item_projects(owner_id,item_id,project_name)
    select owner_id,item_id,new_name from public.work_item_projects where owner_id=uid and project_name=old_name
    on conflict do nothing;
    delete from public.work_item_projects where owner_id=uid and project_name=old_name;
   end if;
   update public.work_items set project_name=new_name,
    project_status=case when p_action='merge' then (select project_status from public.work_projects where owner_id=uid and project_name=new_name) else project_status end,
    updated_at=now() where owner_id=uid and project_name=old_name;
   if p_action='rename' then update public.work_projects set project_name=new_name where owner_id=uid and project_name=old_name;
   else delete from public.work_projects where owner_id=uid and project_name=old_name; end if;
  end if;
 end if;
 insert into public.work_action_logs(owner_id,event_time,action,details,event_date,previous_value,new_value)
 values(uid,now(),'管理要素：'||p_action,coalesce(old_name,'')||' → '||coalesce(new_name,p_phase,''),current_date,old_name,coalesce(new_name,p_phase));
 return jsonb_build_object('ok',true,'changed',affected);
end;
$$;
revoke all on function public.work_taxonomy_manage(text,text,text,text,text) from public, anon;
grant execute on function public.work_taxonomy_manage(text,text,text,text,text) to authenticated;
commit;
