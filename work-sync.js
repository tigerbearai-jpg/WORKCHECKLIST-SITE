/* GPT 工作同步收件箱：无需模型 API 的初版规则匹配。
 * 跨 ChatGPT 对话的无感自动抓取不在本模块能力范围内；
 * ChatGPT 通过已授权 Supabase 连接可以创建 proposal，网页负责人工核实和确认。
 */
import { db } from './supabase-adapter.js';

const el = (id) => document.getElementById(id);
const text = (v) => (v == null ? '' : String(v));
const html = (v) => text(v).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const setStatus = (m) => { if(el('syncStatus')) el('syncStatus').textContent = m; };
let currentOwner = null;
let items = [], steps = [], tasks = [], projects = [], categories = [], itemProjects = [], suggestions = [];
let importLocked = true; // Until source migration is verified and released.

async function mustLogin() {
  const {data,error} = await db.auth.getUser();
  if(error) throw error;
  if(!data.user) throw new Error('请先登录新网站。');
  currentOwner = data.user.id;
  return currentOwner;
}
async function list(table) {
  const owner = await mustLogin();
  const rows=[];
  for(let start=0;start<5000;start+=500){
    const {data,error} = await db.from(table).select('*').eq('owner_id',owner).range(start,start+499);
    if(error)throw error;
    rows.push(...(data||[]));
    if((data||[]).length<500)break;
  }
  return rows;
}
function options(node, data, getValue, getName, placeholder) {
  const prev = node.value;
  node.replaceChildren(new Option(placeholder,''),...data.map(x=>new Option(getName(x),getValue(x))));
  if([...node.options].some(o=>o.value===prev))node.value=prev;
}
function selectedItem(){return items.find(x=>x.item_id===el('syncItem').value)}
function selectedStep(){return steps.find(x=>x.step_id===el('syncStep').value)}
function redrawSelectors(){
  options(el('syncProject'),projects,x=>x.project_name,x=>x.project_name,'不指定项目');
  options(el('syncItem'),items,x=>x.item_id,x=>`${itemProjects.filter(p=>p.item_id===x.item_id).map(p=>p.project_name).join('、')||x.project_name||'未归属'}（${x.title}）`,'请选择已有工作事项');
  options(el('syncCategory'),categories,x=>x.category_name,x=>x.category_name,'不指定分类');
  updateChildSelectors();
}
function updateChildSelectors(){
  const wid=el('syncItem').value;
  const ss=steps.filter(x=>x.item_id===wid).sort((a,b)=>(a.ordinal||0)-(b.ordinal||0));
  options(el('syncStep'),ss,x=>x.step_id,x=>x.title,'不指定步骤');
  const ts=tasks.filter(x=>x.item_id===wid);
  options(el('syncParentTask'),ts,x=>x.task_id,x=>x.suggested_action,'不指定上级任务');
  const tree=el('syncTaskTree');if(!tree)return;tree.replaceChildren();
  if(!ts.length){tree.textContent='当前事项尚无已登记任务。';return;}
  const byParent=new Map();for(const t of ts){const key=t.parent_task_id||'';if(!byParent.has(key))byParent.set(key,[]);byParent.get(key).push(t);}
  const visited=new Set();function addKids(parent='',depth=0){for(const t of byParent.get(parent)||[]){if(visited.has(t.task_id))continue;visited.add(t.task_id);
    const p=document.createElement('p');p.style.paddingLeft=(depth*20)+'px';p.textContent=(depth?'↳ ':'• ')+t.suggested_action+'（'+(t.state||'待办')+'）';tree.append(p);
    addKids(t.task_id,depth+1);
  }}addKids();for(const t of ts){if(!visited.has(t.task_id)){const p=document.createElement('p');p.textContent='• '+t.suggested_action+'（待检查归属）';tree.append(p)}}
}
function grams(s){
  const v=text(s).toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
  if(v.length<=2)return v?[v]:[];
  return [...new Set(Array.from({length:v.length-1},(_,i)=>v.slice(i,i+2)))];
}
function score(a,b){
  const x=grams(a),y=new Set(grams(b));if(!x.length||!y.size)return 0;
  const j=x.filter(z=>y.has(z)).length/Math.max(1,Math.min(x.length,y.size));
  return text(a).includes(text(b))||text(b).includes(text(a))?Math.min(1,j+0.32):j;
}
function recognition(){
  const input=el('syncExcerpt').value.trim();
  if(input.length<6)throw new Error('请先填写本次工作讨论的简要内容（至少6字）。');
  const kind=el('syncKind');
  if(/全新项目|新项目启动|成立新项目/.test(input))kind.value='project';
  else if(/新增工作事项|独立事项|另一个独立工作/.test(input))kind.value='work';
  else if(/分解为子任务|新增子任务/.test(input))kind.value='subtask';
  else if(/新增工作步骤|进入下一步骤/.test(input))kind.value='step';
  else if(/新增任务|下一项任务/.test(input))kind.value='task';
  else kind.value='progress';
  suggestions=items.map(w=>{
    const linked=itemProjects.filter(p=>p.item_id===w.item_id).map(p=>p.project_name);
    const projectText=linked.join('、')||w.project_name||'';
    const projectHit=linked.some(name=>input.includes(name))||(w.project_name&&input.includes(w.project_name));
    const pts=Math.max(score(w.title,input)*0.75,score(projectText,input)*0.40)+(projectHit?0.28:0);
    const best=steps.filter(s=>s.item_id===w.item_id).map(s=>({...s,match:score(s.title,input)})).sort((a,b)=>b.match-a.match)[0];
    return {item_id:w.item_id,step_id:best?.match>=0.52?best.step_id:null,label:`${projectText||'未归属'} / ${w.title}${best?.match>=0.52?' / '+best.title:''}`,score:Math.min(1,pts+(best?.match||0)*0.25)};
  }).filter(x=>x.score>0.15).sort((a,b)=>b.score-a.score).slice(0,3);
  if(suggestions[0]?.score>=0.65 && suggestions[0].score-(suggestions[1]?.score||0)>=0.20){
    el('syncItem').value=suggestions[0].item_id;updateChildSelectors();
    el('syncStep').value=suggestions[0].step_id||'';
  }
  el('syncConfidence').textContent=suggestions[0]?`${Math.round(suggestions[0].score*100)}%（规则匹配，仅供参考）`:'未找到明确关联（需人工指定）';
  el('syncCandidates').innerHTML=suggestions.length?suggestions.map((s,i)=>`<button type="button" data-candidate="${i}" class="secondary" style="margin:4px">${html(s.label)}</button>`).join(''):'没有找到可靠匹配。可以手动选择已有工作，或在确认后新增。';
  for(const btn of el('syncCandidates').querySelectorAll('button'))btn.addEventListener('click',()=>{
    const s=suggestions[Number(btn.dataset.candidate)];el('syncItem').value=s.item_id;updateChildSelectors();el('syncStep').value=s.step_id||'';
  });
  setStatus('已生成归属建议。请检查项目、事项、步骤和操作类型，不会自动创建记录。');
}
function payload(){
  const summary=el('syncExcerpt').value.trim();const kind=el('syncKind').value;
  if(summary.length<6)throw new Error('讨论摘要至少6字。');
  const title=el('syncTitle').value.trim();const item=el('syncItem').value||null;
  const step=el('syncStep').value||null, parent=el('syncParentTask').value||null;
  if(['progress','task','subtask','step'].includes(kind)&&!item)throw new Error('此操作必须选中已有工作事项；无法判断时先不要同步。');
  if(['task','subtask','step','work','project'].includes(kind)&&!title)throw new Error('新增项目、事项、步骤或任务必须有明确名称。');
  if(kind==='subtask'&&!parent)throw new Error('新增子任务必须选择上级任务。');
  const url=el('syncArtifactUrl').value.trim();
  if(url && !/^https:\/\//i.test(url))throw new Error('成果链接必须是可长期访问的 HTTPS 链接，不能使用临时沙盒路径。');
  return {owner_id:currentOwner,source_kind:'chatgpt',source_ref:null,discussion_summary:summary,proposed_kind:kind,
    item_id:item,step_id:step,parent_task_id:parent,project_name:el('syncProject').value||null,
    category_name:el('syncCategory').value||null,title:title||null,next_action:el('syncNext').value.trim()||null,
    artifact_title:el('syncArtifactTitle').value.trim()||null,artifact_url:url||null,
    candidates:suggestions,confidence:suggestions[0]?.score||null,status:'pending'};
}
async function propose(){
  await mustLogin();
  const p=payload();
  // Deterministic submission key: clicking twice must not create duplicate proposals.
  const fingerprint=JSON.stringify([p.proposed_kind,p.item_id,p.step_id,p.parent_task_id,p.discussion_summary,p.title,p.next_action,p.artifact_url]);
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(fingerprint));
  p.source_ref='manual-'+Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,'0')).join('').slice(0,40);
  const {error}=await db.from('work_sync_inbox').insert(p);
  if(error?.code==='23505'){
    setStatus('相同内容已经保存过，未重复添加。');await refreshInbox();return;
  }
  if(error)throw error;
  setStatus('已保存至待确认收件箱；尚未修改业务事项。');
  await refreshInbox();
}
async function refreshInbox(){
  const rows=(await list('work_sync_inbox')).sort((a,b)=>(b.created_at||'').localeCompare(a.created_at||''));
  const host=el('syncInbox');host.replaceChildren();
  if(!rows.length){host.textContent='暂无待确认记录。';return}
  for(const p of rows.slice(0,60)){
    const div=document.createElement('div');div.className='panel';
    const item=items.find(w=>w.item_id===p.item_id);
    const desc=document.createElement('p');desc.textContent=`${({progress:'进展',task:'任务',subtask:'子任务',step:'步骤',work:'事项',project:'项目'}[p.proposed_kind]||p.proposed_kind)} · ${p.title||item?.title||'未命名'} · ${p.status==='pending'?'待确认':p.status==='applied'?'已写入':'已忽略'}`;
    div.append(desc);
    const summary=document.createElement('p');summary.className='muted';summary.textContent=p.discussion_summary.slice(0,500);div.append(summary);
    if(p.status==='pending'){
      const actions=document.createElement('div');actions.className='flex';
      const yes=document.createElement('button');yes.className='primary';yes.type='button';yes.textContent=importLocked?'等待历史数据认领后确认':'确认写入工作记录';yes.disabled=importLocked;
      yes.onclick=()=>withError(async()=>{
        if(!confirm('确认将这条建议写入工作记录？该操作会保留历史。'))return;
        const {data,error}=await db.rpc('work_sync_confirm',{p_proposal_id:p.proposal_id});if(error)throw error;
        setStatus('已更新工作记录：'+JSON.stringify(data));await reload();if(typeof window.refresh==='function')await window.refresh();
      });
      const no=document.createElement('button');no.className='secondary';no.type='button';no.textContent='忽略';
      no.onclick=()=>withError(async()=>{const {error}=await db.rpc('work_sync_reject',{p_proposal_id:p.proposal_id});if(error)throw error;await refreshInbox()});
      actions.append(yes,no);div.append(actions);
    }
    host.append(div);
  }
}
async function reload(){
  await mustLogin();
  [items,steps,tasks,projects,categories,itemProjects]=await Promise.all(['work_items','work_steps','work_tasks','work_projects','work_categories','work_item_projects'].map(list));
  redrawSelectors();await refreshInbox();
}
async function withError(fn){try{await fn()}catch(e){setStatus('操作失败：'+(e?.message||e))}}
window.refreshWorkSync=()=>withError(reload);
document.addEventListener('DOMContentLoaded',()=>{
  el('syncItem')?.addEventListener('change',updateChildSelectors);
  el('syncRecognize')?.addEventListener('click',()=>withError(async()=>recognition()));
  el('syncSave')?.addEventListener('click',()=>withError(propose));
  el('syncReload')?.addEventListener('click',()=>withError(reload));
  // No records are automatically read from conversations; only user-supplied or authorized proposals.
});