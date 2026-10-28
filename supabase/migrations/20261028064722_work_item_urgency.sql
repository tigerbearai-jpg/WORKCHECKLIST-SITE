-- Add per-work-item urgency without changing ownership or RLS policies.
begin;
alter table public.work_items
 add column if not exists urgency text not null default '正常'
 constraint work_items_urgency_check check (urgency in ('紧急','急','正常'));
commit;
