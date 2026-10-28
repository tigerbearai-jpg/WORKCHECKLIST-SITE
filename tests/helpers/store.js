import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
export const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const identifier=s=>{if(!/^[a-z_][a-z_0-9]*$/.test(s))throw Error('Invalid SQL identifier');return '"'+s+'"';};
export class Store{
 static async create(){
  const store=new Store();store.db=new PGlite();store.queue=Promise.resolve();
  await store.db.exec(`create role anon; create role authenticated; create schema auth;
   create table auth.users(id uuid primary key);
   create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
   grant usage on schema public,auth to anon,authenticated;
   grant execute on function auth.uid() to anon,authenticated;`);
  await store.db.exec(await readFile('tests/fixtures/schema-before-workbench.sql','utf8'));
  // Current sync tables are read by the adapter; no sync RPC is replaced by this change.
  await store.db.exec(`create table public.work_activity_events(owner_id uuid,item_id text,step_id text,summary text,occurred_at timestamptz);
   create table public.work_tasks(owner_id uuid,task_id text,item_id text,step_id text,parent_task_id text,suggested_action text);
   create table public.work_sync_inbox(owner_id uuid,proposal_id uuid default gen_random_uuid(),discussion_summary text,proposed_kind text,item_id text,status text,created_at timestamptz default now());
   grant select,insert on public.work_activity_events,public.work_tasks,public.work_sync_inbox to authenticated;
   insert into auth.users values('${A}'),('${B}');`);
  await store.db.exec(await readFile('database/202610270010_workbench.sql','utf8'));
  await store.db.exec(await readFile('supabase/migrations/20261028064722_work_item_urgency.sql','utf8'));
  return store;
 }
 request(spec,actor=A){
  const task=this.queue.then(()=>this.run(spec,actor));this.queue=task.catch(()=>{});return task;
 }
 async run(s,actor){
  const values=[];const param=v=>{values.push(v);return '$'+values.length;};
  try{
   await this.db.exec('begin; set local role '+(actor?'authenticated':'anon')+';');
   await this.db.query("select set_config('request.jwt.claim.sub',$1,true)",[actor||'']);
   let sql;
   if(s.action==='rpc'){
    const parameters={work_taxonomy_manage:['p_kind','p_action','p_old_name','p_new_name','p_phase']}[s.fn];
    if(!parameters)throw Error('Unexpected RPC');
    sql='select public.'+identifier(s.fn)+'('+parameters.map(k=>param(s.args[k]??null)).join(',')+') as result';
   }else{
    const table='public.'+identifier(s.table);
    const where=()=>s.filters?.length?' where '+s.filters.map(f=>identifier(f.column)+(f.in?' = any('+param(f.value)+')':' = '+param(f.value))).join(' and '):'';
    if(s.action==='select'){
     sql='select '+(s.columns&&s.columns!=='*'?s.columns.split(',').map(identifier).join(','):'*')+' from '+table+where();
     if(s.range)sql+=' limit '+param(s.range[1]-s.range[0]+1)+' offset '+param(s.range[0]);
    }else if(s.action==='delete')sql='delete from '+table+where()+' returning *';
    else if(s.action==='update')sql='update '+table+' set '+Object.keys(s.values).map(k=>identifier(k)+'='+param(s.values[k])).join(',')+where()+' returning *';
    else{
     const rows=Array.isArray(s.rows)?s.rows:[s.rows],keys=Object.keys(rows[0]);
     sql='insert into '+table+' ('+keys.map(identifier).join(',')+') values '+rows.map(row=>'('+keys.map(k=>param(row[k]??null)).join(',')+')').join(',');
     if(s.action==='upsert'){const updates=keys.filter(k=>!s.conflict.split(',').includes(k)).map(k=>identifier(k)+'=excluded.'+identifier(k));sql+=' on conflict ('+s.conflict.split(',').map(identifier).join(',')+') '+(updates.length?'do update set '+updates.join(','):'do nothing');}
     sql+=' returning *';
    }
   }
   const result=await this.db.query(sql,values);await this.db.exec('commit');
   // Match the JSON wire format returned by Supabase REST, including dates.
   return {data:JSON.parse(JSON.stringify(s.action==='rpc'?result.rows[0].result:result.rows)),error:null};
  }catch(e){await this.db.exec('rollback');return {data:null,error:{message:e.message,code:e.code}};}
 }
 async seed(){
  await this.db.query(`insert into public.work_categories(owner_id,category_name) values($1,'合同'),($1,'采购'),($2,'合同');`,[A,B]);
  await this.db.query(`insert into public.work_projects(owner_id,project_name,project_status) values($1,'甲','在营'),($1,'乙','筹备'),($2,'甲','在营')`,[A,B]);
  for(let i=0;i<40;i++){
   const cats=i%3===0?['合同','采购']:i%3===1?['合同']:['采购'];
   await this.db.query(`insert into public.work_items(owner_id,item_id,title,category_name,category_names,project_name,project_status,item_status,latest_progress,confidence,notes)
    values($1,$2,$3,$4,$5,'甲','在营',$6,'进展说明','已核实','背景')`,[A,'w'+i,'事项'+i,cats[0],cats,['进行中','已完成','暂停','历史待核实'][i%4]]);
   await this.db.query(`insert into public.work_item_projects values($1,$2,'甲',now()),($1,$2,'乙',now())`,[A,'w'+i]);
  }
  await this.db.query(`insert into public.work_items(owner_id,item_id,title,item_status) values($1,'deleted','删除事项','已删除'),($2,'other','他人事项','进行中')`,[A,B]);
  await this.db.query(`insert into public.work_steps(owner_id,step_id,item_id,ordinal,title,state) values($1,'s24a','w24',1,'核价','进行中'),($1,'s24b','w24',2,'签署','待完成')`,[A]);
  await this.db.query(`insert into public.work_sop_templates(owner_id,sop_id,template_name,category_name,state,keywords) values($1,'s1','合同模板','合同','已发布','事项'),($1,'s2','采购模板','采购','已发布','事项')`,[A]);
 }
 async close(){await this.queue;await this.db.close();}
}
