/* WORKCHECKLIST migration adapter. No secret/service_role keys may be used here. */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.0/+esm';
import { currentProgress, categoryNames, filterWork } from './work-model.js';
window.workModel={currentProgress,categoryNames,filterWork};
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

const db = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const IMPORT_LOCKED = false; // Historical data has been verified and assigned to the signed-in account.
let currentUser = null;
const $ = id=>document.getElementById(id);
const str = v => (v === null || v === undefined ? '' : String(v));
const nz = v => str(v) || null;
const dateOnly = v => str(v).slice(0,10);
const today = () => new Date().toISOString().slice(0,10);
const err = (error) => { if(error)throw Error(error.message || String(error)); };
async function userId(){
  const {data,error} = await db.auth.getUser();err(error);
  if(!data.user)throw Error('登录状态已失效，请重新登录。');
  currentUser=data.user;
  return currentUser.id;
}
async function selectTable(table){
  const uid=await userId();
  const all=[];
  for(let page=0;page<100;page++){
    const {data,error}=await db.from(table).select('*').eq('owner_id',uid).range(page*500,page*500+499);
    err(error);all.push(...(data||[]));
    if((data||[]).length < 500)return all;
  }
  throw Error('记录超出当前查询上限，请使用分页。');
}
async function insertRows(table,rows){
  const uid=await userId();
  const {error}=await db.from(table).insert(rows.map(v=>({...v,owner_id:uid})));err(error);
}
async function updateRows(table,columns,match){
  const uid=await userId();
  let q=db.from(table).update(columns).eq('owner_id',uid);
  Object.entries(match).forEach(([k,v])=>{q=q.eq(k,v)});
  const {error}=await q;err(error);
}
async function deleteRows(table,match){
  const uid=await userId();
  let q=db.from(table).delete().eq('owner_id',uid);
  Object.entries(match).forEach(([k,v])=>{q=q.eq(k,v)});
  const {error}=await q;err(error);
}
function requireWrite(){if(IMPORT_LOCKED)throw Error('为防止覆盖原始数据，迁移确认前暂不开放新增、修改或删除。');}
async function writeLog(itemId,action,details,stepId='',previous='',next=''){
  await insertRows('work_action_logs',[{item_id:itemId||null,action,details,step_id:stepId||null,event_time:new Date().toISOString(),event_date:today(),previous_value:previous||null,new_value:next||null}]);
}
function shapeWork(rows,stepRows,projectLinks,projectRows){return rows.map(r=>{
  const steps=stepRows.filter(s=>s.item_id===r.item_id).sort((a,b)=>a.ordinal-b.ordinal).map(s=>({
    id:s.step_id,workId:s.item_id,order:s.ordinal,text:s.title,status:s.state||'待完成',hint:str(s.reminders),materials:str(s.required_docs),risk:str(s.risk_notes),source:str(s.sop_origin),completedAt:dateOnly(s.finished_date)
  }));
  const applicable=steps.filter(s=>s.status!=='不适用');
  const cells=r.source_json?.cells||[];
  const linked=(projectLinks||[]).filter(x=>x.item_id===r.item_id).map(x=>x.project_name).sort((a,b)=>a.localeCompare(b,'zh-CN'));
  const projectNames=linked.length?linked:(str(r.project_name).trim()?[str(r.project_name).trim()]:[]);
  const projectByName=new Map((projectRows||[]).map(x=>[x.project_name,x]));
  const phaseNames=[...new Set(projectNames.map(name=>str(projectByName.get(name)?.project_status)).filter(Boolean))];
  const projectDisplay=projectNames.map(name=>{const phase=str(projectByName.get(name)?.project_status);return phase?name+'（'+phase+'）':name;}).join('、');
  return {id:r.item_id,name:str(r.title),category:categoryNames(r.category_names,r.category_name).join('、'),categories:categoryNames(r.category_names,r.category_name),projectDetails:projectNames.map(name=>({name,phase:str(projectByName.get(name)?.project_status||r.project_status)})),project:projectNames.join('、'),projects:projectNames,projectDisplay,phase:phaseNames.join('、'),status:str(r.item_status)||'进行中',follow:str(r.followup_status),progress:currentProgress(steps,str(r.latest_progress)),progressDetail:str(r.latest_progress),legacyNext:str(r.next_step||cells[8]),start:dateOnly(r.last_progress_date),followDate:dateOnly(r.next_followup_date),due:dateOnly(r.target_date),note:str(r.notes),confidence:str(r.confidence),sop:str(r.sop_id),percent:applicable.length?Math.round(applicable.filter(s=>s.status==='已完成').length/applicable.length*100):null,steps};
});}
async function allData(){
 const tables=['work_items','work_steps','work_categories','work_projects','work_sop_templates','work_item_projects'];
 const [items,steps,categories,projects,templates,projectLinks]=await Promise.all(tables.map(selectTable));
 return {work:shapeWork(items,steps,projectLinks,projects),categories:categories.filter(x=>x.is_active!==false).map(x=>x.category_name).sort(),categoryElements:categories.map(x=>({name:x.category_name,inactive:x.is_active===false})),projects:projects.map(x=>({name:x.project_name,phase:str(x.project_status),inactive:x.is_active===false})).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN')),templates:templates.map(x=>({id:x.sop_id,name:x.template_name,category:str(x.category_name),keywords:str(x.keywords),condition:str(x.conditions),version:str(x.version),status:str(x.state)}))};
}
function cleanDate(s){return /^\d{4}-\d{2}-\d{2}$/.test(str(s))?s:null;}
function formatStep(s){return {text:s.title,completedAt:dateOnly(s.finished_date),status:s.state,workId:s.item_id};}
async function stepsForSop(id){const rows=await selectTable('work_sop_steps');return rows.filter(x=>x.sop_id===id).sort((a,b)=>a.ordinal-b.ordinal);}
async function historyQuery(options={}){
 const {from='',to='',mode='activity',category='',project='',keyword=''}=options;
 if(from&&to&&from>to)throw Error('开始日期不能晚于结束日期');
 const [d,logs,aiLogs]=await Promise.all([allData(),selectTable('work_action_logs'),selectTable('work_activity_events')]);
 const inRange=s=>!!s&&(!from||s>=from)&&(!to||s<=to);
 const events=[...logs.map(x=>({id:str(x.item_id),action:str(x.action),description:str(x.details),eventDate:dateOnly(x.event_date)||dateOnly(x.event_time),stepId:str(x.step_id)})),...aiLogs.map(x=>({id:str(x.item_id),action:'GPT工作同步',description:str(x.summary),eventDate:dateOnly(x.occurred_at),stepId:str(x.step_id)}))].filter(x=>inRange(x.eventDate));
 const rows=d.work.filter(w=>w.status!=='已删除'&&(!category||w.categories.includes(category))&&(!project||(w.projects||[w.project]).includes(project))&&(!keyword||(w.name+w.progress+w.project).toLowerCase().includes(keyword.toLowerCase()))).map(w=>{
   const acts=events.filter(e=>e.id===w.id);
   const completed=w.steps.filter(s=>s.status==='已完成'&&inRange(s.completedAt)).map(s=>({text:s.text,date:s.completedAt}));
   const inPeriod=mode==='started'?inRange(w.start):mode==='completed'?completed.length>0||acts.some(x=>x.action==='修改事项状态'&&x.description.endsWith('已完成')):mode==='all'?true:acts.length>0||completed.length>0;
   return {...w,completed,events:acts,inPeriod};
 }).filter(w=>w.inPeriod);
 return {rows,total:rows.length,from,to,mode};
}
function b64UTF8(strValue){const bytes=new TextEncoder().encode(strValue);let s='';for(let i=0;i<bytes.length;i+=8192){s+=String.fromCharCode(...bytes.slice(i,i+8192))}return btoa(s)}
async function exportAssessment(options){
 const r=await historyQuery(options);
 const head=['事项ID','事项名称','业务分类','所属项目','项目状态','开始日期','计划完成日期','目前进展','当前状态','完成度','期间完成步骤','完成日期','期间工作记录','记录日期'];
 const q=v=>'"'+str(v).replaceAll('"','""')+'"';
 const lines=[head];for(const w of r.rows){const n=Math.max(w.completed.length,w.events.length,1);for(let i=0;i<n;i++)lines.push([w.id,w.name,w.category,w.project,w.phase,w.start,w.due,w.progress,w.status,w.percent===null?'':w.percent+'%',w.completed[i]?.text||'',w.completed[i]?.date||'',w.events[i]?w.events[i].action+'：'+w.events[i].description:'',w.events[i]?.eventDate||'']);}
 return {name:`工作考核_${r.from||'全部'}_${r.to||'全部'}.csv`,base64:b64UTF8('\ufeff'+lines.map(row=>row.map(q).join(',')).join('\r\n')),count:r.total};
}
const backend={
 data:allData,
 async categoryAdd(name){requireWrite();if(!str(name).trim())throw Error('请输入分类名称');await insertRows('work_categories',[{category_name:name.trim()}]);return allData()},
 async projectAdd(name,phase){requireWrite();if(!str(name).trim())throw Error('请输入项目名称');await insertRows('work_projects',[{project_name:name.trim(),project_status:phase||'筹备'}]);return allData()},
 async taxonomyManage(kind,action,oldName,newName,phase){requireWrite();const {data,error}=await db.rpc('work_taxonomy_manage',{p_kind:kind,p_action:action,p_old_name:oldName,p_new_name:newName,p_phase:phase||null});err(error);return data},
 async saveWork(p){
 requireWrite();
 if(!str(p?.name).trim())throw Error('工作名称不能为空');
 const uid=await userId(),id=p.id||('W'+Date.now().toString(36)+Math.random().toString(36).slice(2,7));
 const selected=[...new Set((Array.isArray(p.projects)?p.projects:(p.project?[p.project]:[])).map(x=>str(x).trim()).filter(Boolean))];
 let projectRows=[];
 if(selected.length){const result=await db.from('work_projects').select('project_name,project_status').eq('owner_id',uid).in('project_name',selected);err(result.error);projectRows=result.data||[];}
 const known=new Set(projectRows.map(x=>x.project_name)),missing=selected.filter(x=>!known.has(x));
 if(missing.length)throw Error('以下项目已不存在，请刷新后重新选择：'+missing.join('、'));
 const primary=selected[0]||null,primaryRow=projectRows.find(x=>x.project_name===primary);
 const selectedCategories=categoryNames(Array.isArray(p.categories)?p.categories:[],p.categories===undefined?str(p.category):'');
 const payload={owner_id:uid,item_id:id,title:p.name,project_name:primary,project_status:nz(primaryRow?.project_status||p.phase),item_status:p.status||'进行中',latest_progress:nz(p.progress),last_progress_date:cleanDate(p.start),target_date:cleanDate(p.due),updated_at:new Date().toISOString()};
 if(p.categories!==undefined||p.category!==undefined||!p.id){payload.category_name=selectedCategories[0]||null;payload.category_names=selectedCategories;}
 if(p.note!==undefined)payload.notes=nz(p.note);
 if(p.follow!==undefined)payload.followup_status=nz(p.follow);
 if(p.sop!==undefined)payload.sop_id=nz(p.sop);
 const {error}=await db.from('work_items').upsert(payload,{onConflict:'owner_id,item_id'});err(error);
 const {data:oldLinks,error:oldError}=await db.from('work_item_projects').select('project_name').eq('owner_id',uid).eq('item_id',id);err(oldError);
 if(selected.length){const {error:linkError}=await db.from('work_item_projects').upsert(selected.map(project_name=>({owner_id:uid,item_id:id,project_name})),{onConflict:'owner_id,item_id,project_name'});err(linkError);}
 const removed=(oldLinks||[]).map(x=>x.project_name).filter(name=>!selected.includes(name));
 if(removed.length){const {error:removeError}=await db.from('work_item_projects').delete().eq('owner_id',uid).eq('item_id',id).in('project_name',removed);err(removeError);}
 await writeLog(id,p.id?'修改事项':'新增事项',p.name+'；所属项目：'+(selected.join('、')||'未关联项目'));
 return {id};
 },
 async saveSteps(workId,list){requireWrite();if(!workId)throw Error('缺少事项ID');const uid=await userId();const old=(await selectTable('work_steps')).filter(s=>s.item_id===workId),ids=new Set();const incoming=(list||[]).filter(s=>str(s.text).trim()).map((s,i)=>{const id=s.id||crypto.randomUUID();ids.add(id);const previous=old.find(o=>o.step_id===id);return {owner_id:uid,step_id:id,item_id:workId,ordinal:i+1,title:str(s.text),state:s.status||'待完成',reminders:nz(s.hint),required_docs:nz(s.materials),risk_notes:nz(s.risk),sop_origin:nz(s.source),finished_date:s.status==='已完成'?(cleanDate(s.completedAt)||cleanDate(previous?.finished_date)||today()):null};});
 if(incoming.length){const {error}=await db.from('work_steps').upsert(incoming,{onConflict:'owner_id,step_id'});err(error)}
 const toDelete=old.filter(s=>!ids.has(s.step_id));if(toDelete.length){const {error}=await db.from('work_steps').delete().eq('owner_id',uid).eq('item_id',workId).in('step_id',toDelete.map(s=>s.step_id));err(error)}
 for(const step of incoming){
  const previous=old.find(s=>s.step_id===step.step_id);
  if(!previous)await writeLog(workId,'新增工作步骤',step.title,step.step_id);
  if(step.state==='已完成'&&previous?.state!=='已完成')await writeLog(workId,'完成工作步骤',step.title,step.step_id,previous?.state||'',step.state);
  else if(previous?.state==='已完成'&&step.state!=='已完成')await writeLog(workId,'重新打开工作步骤',step.title,step.step_id,previous.state,step.state);
  else if(previous&&previous.state!==step.state)await writeLog(workId,'修改步骤状态',step.title,step.step_id,previous.state,step.state);
  if(previous&&previous.title!==step.title)await writeLog(workId,'修改步骤内容',step.title,step.step_id,previous.title,step.title);
 }
 for(const step of toDelete)await writeLog(workId,'删除工作步骤',step.title,step.step_id);
 return {ok:true};},
 async workDelete(id){requireWrite();await updateRows('work_items',{item_status:'已删除'},{item_id:id});await writeLog(id,'删除事项（软删除）','状态设为已删除');return {ok:true};},
 historyQuery,exportAssessment,
 async matchSop(category,description){const d=await allData();const text=str(description).toLowerCase();return d.templates.filter(t=>categoryNames(Array.isArray(category)?category:[],typeof category==='string'?category:'').includes(t.category)&&t.status==='已发布').map(t=>({id:t.id,name:t.name,score:t.keywords.split(',').map(k=>k.trim().toLowerCase()).filter(Boolean).filter(k=>text.includes(k)).length})).sort((a,b)=>b.score-a.score)},
 async sopSteps(id){const rows=await stepsForSop(id);return rows.map(s=>({text:s.step_name,status:'待完成',hint:str(s.reminders),materials:str(s.required_docs),risk:str(s.risk_notes),condition:str(s.conditions),source:id}))},
 async sopDetail(id){const d=await allData();const t=d.templates.find(x=>x.id===id);if(!t)throw Error('SOP 不存在');const rows=await stepsForSop(id);return {...t,keywords:t.keywords.split(',').filter(Boolean),steps:rows.map(x=>({name:x.step_name,hint:str(x.reminders),materials:str(x.required_docs),risk:str(x.risk_notes),condition:str(x.conditions)}))}},
 async importSop(p){requireWrite();if(typeof p==='string')p=JSON.parse(p);if(!p?.name||!p.category||!Array.isArray(p.steps)||!p.steps.length)throw Error('请输入 SOP 名称、分类和步骤');const id='SOP-'+crypto.randomUUID().slice(0,8);await insertRows('work_sop_templates',[{sop_id:id,template_name:p.name,category_name:p.category,keywords:(p.keywords||[]).join(','),conditions:nz(p.condition),version:p.version||'1.0',state:p.status||'草稿'}]);await insertRows('work_sop_steps',p.steps.map((s,i)=>({sop_id:id,ordinal:i+1,step_name:str(s.name||s.text),reminders:nz(s.hint),required_docs:nz(s.materials),risk_notes:nz(s.risk),conditions:nz(s.condition)})));return {id,count:p.steps.length}},
 async updateSop(id,p){requireWrite();if(!p?.name||!Array.isArray(p.steps)||!p.steps.length)throw Error('SOP 缺少名称或步骤');await updateRows('work_sop_templates',{template_name:p.name,category_name:p.category,keywords:(p.keywords||[]).join(','),conditions:nz(p.condition),version:p.version||'1.0',state:p.status||'草稿'},{sop_id:id});await deleteRows('work_sop_steps',{sop_id:id});await insertRows('work_sop_steps',p.steps.map((s,i)=>({sop_id:id,ordinal:i+1,step_name:str(s.name||s.text),reminders:nz(s.hint),required_docs:nz(s.materials),risk_notes:nz(s.risk),conditions:nz(s.condition)})));return {ok:true}},
 async aiDiscuss(){return {enabled:false,message:'当前零 API 方案；可复制事项背景，在 Codex 中讨论。'}}
};
window.workBackend=backend;
function showAuth(message=''){
 const backdrop=$('authBackdrop');if(backdrop)backdrop.hidden=false;
 if($('authNotice'))$('authNotice').textContent=message;
 if($('logoutBtn'))$('logoutBtn').hidden=true;
}
function showApp(){
 if($('authBackdrop'))$('authBackdrop').hidden=true;
 if($('logoutBtn'))$('logoutBtn').hidden=false;
 if($('readOnlyNotice'))$('readOnlyNotice').hidden=!IMPORT_LOCKED;
}
async function loadAuth(){
 const {data,error}=await db.auth.getSession();err(error);
 currentUser=data.session?.user||null;
 if(!currentUser){showAuth();return false}
 showApp();return true;
}
window.initializeWorkApp=loadAuth;
async function handleAuth(action){
 const email=$('authEmail').value.trim(),password=$('authPassword').value;
 if(!email||!password)throw Error('请填写邮箱和密码。');
 if(action==='signup'){
   const {data,error}=await db.auth.signUp({email,password,options:{emailRedirectTo:location.origin+location.pathname}});err(error);
   if(!data.session){showAuth('注册请求已提交，请检查邮箱确认邮件，然后返回这里登录。');return}
 }else{const {error}=await db.auth.signInWithPassword({email,password});err(error)}
 const ok=await loadAuth();if(ok&&typeof window.refresh==='function')await window.refresh();
}
document.addEventListener('DOMContentLoaded',()=>{
 $('authForm')?.addEventListener('submit',async event=>{event.preventDefault();try{$('authNotice').textContent='正在登录…';await handleAuth('signin')}catch(e){showAuth('登录失败：'+e.message)}});
 $('signupBtn')?.addEventListener('click',async()=>{try{$('authNotice').textContent='正在注册…';await handleAuth('signup')}catch(e){showAuth('注册失败：'+e.message)}});
 $('logoutBtn')?.addEventListener('click',async()=>{const {error}=await db.auth.signOut();if(error)console.error(error);currentUser=null;showAuth('已退出登录。');});
});
db.auth.onAuthStateChange((event,session)=>{
 if(event==='SIGNED_OUT'){currentUser=null;showAuth('已退出登录。')}
 else if(event==='SIGNED_IN'&&session?.user&&$('authBackdrop')&&!$('authBackdrop').hidden){currentUser=session.user;showApp();if(typeof window.refresh==='function')window.refresh();}
});

export { db };