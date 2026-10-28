import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {Store,A,B} from './helpers/store.js';
import {makeClient} from './helpers/client.js';
import {categoryNames,currentProgress,filterWork,urgencyRank,workUrgency,sortByUrgency} from '../work-model.js';
let store,backend;
before(async()=>{
 store=await Store.create();await store.seed();
 const db=makeClient(s=>store.request(s,A),()=>A);
 const source=(await readFile('supabase-adapter.js','utf8')).replace(/^import .*;\n/gm,'').replace(/^export \{ db \};/gm,'');
 const context=vm.createContext({createClient:()=>db,SUPABASE_URL:'https://test.invalid',SUPABASE_PUBLISHABLE_KEY:'test-public',currentProgress,categoryNames,filterWork,urgencyRank,workUrgency,sortByUrgency,window:{},document:{addEventListener(){},getElementById(){return null}},TextEncoder,btoa,crypto:globalThis.crypto,console});
 vm.runInContext(source,context);backend=context.window.workBackend;
});
after(async()=>store?.close());
test('no login cannot read work or invoke maintenance; users are isolated on read and write',async()=>{
 assert((await store.request({table:'work_items',action:'select'},null)).error);
 const b=await store.request({table:'work_items',action:'select'},B);assert.deepEqual(b.data.map(x=>x.item_id),['other']);
 assert((await store.request({table:'work_items',action:'insert',rows:{owner_id:B,item_id:'intrusion',title:'bad'}},A)).error);
 const update=await store.request({table:'work_items',action:'update',values:{title:'bad'},filters:[{column:'item_id',value:'other'}]},A);assert.equal(update.data.length,0);
 assert((await store.request({action:'rpc',fn:'work_taxonomy_manage',args:{p_kind:'project',p_action:'disable',p_old_name:'甲'}},null)).error);
});
test('progress, categories and project-phase filters handle parallel steps and multi-project membership',async()=>{
 assert.equal(currentProgress([{text:'核价',status:'进行中'},{text:'审批',status:'进行中'}]),'核价；审批');
 assert.equal(currentProgress([{text:'核价',status:'进行中'}],'旧进展说明'),'核价');
 assert.equal(currentProgress([{text:'签署',status:'待完成'}]),'待开始下一步');
 assert.equal(currentProgress([]),'尚未记录');
 assert.equal(currentProgress([],'旧进展说明'),'尚未记录');
 assert.equal(currentProgress([{text:'签署',status:'已完成'},{text:'归档',status:'不适用'}]),'全部步骤已完成');
 assert.equal(currentProgress([{text:'',status:'进行中'},{text:'略过',status:'不适用'}]),'尚未记录');
 const d=await backend.data(),w=d.work.find(x=>x.id==='w24');assert.equal(w.projects.length,2);assert.equal(w.progress,'核价');
 assert.equal(filterWork([w],{project:'乙',phase:'筹备',category:'采购'}).length,1);
 assert.equal(filterWork([w],{project:'甲',phase:'筹备'}).length,0,'phase must belong to the selected project');
});
test('save multi-category and notes without losing projects, confidence, SOP or followup',async()=>{
 await store.db.query("update work_items set sop_id='original',followup_status='跟进',latest_progress='原有进展说明' where owner_id=$1 and item_id='w4'",[A]);
 await backend.saveWork({id:'w4',name:'事项4',categories:['合同','采购'],projects:['甲','乙'],note:'新备注'});
 const row=(await store.db.query("select * from work_items where owner_id=$1 and item_id='w4'",[A])).rows[0];
 assert.deepEqual(row.category_names,['合同','采购']);assert.equal(row.notes,'新备注');assert.equal(row.confidence,'已核实');assert.equal(row.sop_id,'original');assert.equal(row.followup_status,'跟进');assert.equal(row.latest_progress,'原有进展说明');
 const work=(await backend.data()).work.find(x=>x.id==='w4');
 assert.equal(work.projects.length,2);assert.equal(work.progress,'尚未记录');assert.equal(work.note,'新备注');
 assert.equal((await backend.matchSop(['合同','采购'],'事项')).length,2);
 assert((await backend.historyQuery({mode:'all',category:'采购'})).rows.some(x=>x.id==='w4'));
});
test('step completion retains history and never starts the next step',async()=>{
 await backend.saveSteps('w24',[{id:'s24a',text:'核价',status:'已完成',completedAt:'2026-10-27'},{id:'s24b',text:'签署',status:'待完成'}]);
 const w=(await backend.data()).work.find(w=>w.id==='w24');assert.equal(w.progress,'待开始下一步');assert.equal(w.steps[1].status,'待完成');
 assert((await backend.historyQuery({mode:'all'})).rows.find(w=>w.id==='w24').events.some(e=>e.action==='完成工作步骤'));
});
test('category rename/merge updates all memberships and SOPs without duplicates; deletion protects references',async()=>{
 await assert.rejects(()=>backend.taxonomyManage('category','retire','采购',''),/关联/);
 await backend.taxonomyManage('category','rename','合同','法务');
 let w=(await backend.data()).work.find(w=>w.id==='w0');assert.deepEqual(Array.from(w.categories),['法务','采购']);
 await backend.taxonomyManage('category','merge','法务','采购');
 w=(await backend.data()).work.find(w=>w.id==='w0');assert.deepEqual(Array.from(w.categories),['采购']);
 const other=(await store.db.query('select category_name from work_categories where owner_id=$1',[B])).rows;assert.equal(other[0].category_name,'合同');
});
test('project rename, disable, phase update and merge preserve multi-project links',async()=>{
 await backend.taxonomyManage('project','rename','乙','乙新');
 assert((await backend.data()).work.find(w=>w.id==='w0').projects.includes('乙新'));
 await backend.taxonomyManage('project','phase','乙新','','平台');
 assert((await backend.data()).work.find(w=>w.id==='w0').projectDetails.some(p=>p.name==='乙新'&&p.phase==='平台'));
 await backend.taxonomyManage('project','disable','乙新','');
 let data=await backend.data();assert(data.projects.find(p=>p.name==='乙新').inactive);assert(data.work[0].projects.includes('乙新'));
 await backend.taxonomyManage('project','merge','乙新','甲');
 assert.deepEqual(Array.from((await backend.data()).work.find(w=>w.id==='w0').projects),['甲']);
});
test('migration can be applied again without dropping data; original category punctuation stays intact',async()=>{
 await store.db.query("insert into work_items(owner_id,item_id,title,category_name) values($1,'punctuation','标点','合同、审查,重点')",[A]);
 await store.db.exec(await readFile('database/202610270010_workbench.sql','utf8'));
 const row=(await store.db.query("select category_names from work_items where item_id='punctuation'")).rows[0];assert.deepEqual(row.category_names,['合同、审查,重点']);
});
test('urgency sorting reads each work item and keeps equal ranks stable without changing input',()=>{
 const normal={id:'normal',urgency:'正常',projectDetails:[{name:'甲'}]};
 const urgent={id:'urgent',urgency:'急',projectDetails:[{name:'甲'},{name:'乙'}]};
 const highest={id:'highest',urgency:'紧急',projectDetails:[{name:'甲'},{name:'乙',inactive:true}]};
 const tied={id:'tied',urgency:'紧急',projectDetails:[{name:'丙'}]};
 const missing={id:'missing'},unknown={id:'unknown',urgency:'invalid'};
 const source=[normal,urgent,highest,tied,missing,unknown],original=source.slice();
 assert.equal(urgencyRank('紧急'),0);assert.equal(urgencyRank('急'),1);assert.equal(urgencyRank('正常'),2);assert.equal(urgencyRank('unknown'),2);
 assert.equal(workUrgency(highest),'紧急');assert.equal(workUrgency(missing),'正常');assert.equal(workUrgency(unknown),'正常');
 assert.equal(workUrgency({urgency:'正常',projectDetails:[{urgency:'紧急'}]}),'正常');
 assert.deepEqual(sortByUrgency(source).map(x=>x.id),['highest','tied','urgent','normal','missing','unknown']);
 assert.deepEqual(source,original);
 const filtered=filterWork([highest],{project:'甲'});assert.equal(sortByUrgency(filtered)[0],highest);assert.equal(workUrgency(filtered[0]),'紧急');
});
test('work urgency defaults and saves enforce enum and ownership without clearing omitted urgency',async()=>{
 assert((await backend.data()).work.every(w=>w.urgency==='正常'));
 const anonymous=await store.request({table:'work_items',action:'update',values:{urgency:'紧急'},filters:[{column:'item_id',value:'w0'}]},null);assert(anonymous.error);
 const foreign=await store.request({table:'work_items',action:'update',values:{urgency:'紧急'},filters:[{column:'item_id',value:'other'}]},A);assert.equal(foreign.data.length,0);
 const intrusion=await store.request({table:'work_items',action:'upsert',rows:{owner_id:B,item_id:'other',title:'他人事项',urgency:'紧急'},conflict:'owner_id,item_id'},A);assert(intrusion.error);
 await assert.rejects(()=>backend.saveWork({id:'w0',name:'事项0',projects:['甲'],urgency:'很急'}),/无效/);
 const invalid=await store.request({table:'work_items',action:'update',values:{urgency:'很急'},filters:[{column:'item_id',value:'w0'}]},A);assert(invalid.error);
 await backend.saveWork({id:'w0',name:'事项0',projects:['甲'],urgency:'紧急'});
 await backend.saveWork({id:'w4',name:'事项4',projects:['甲'],urgency:'急'});
 let d=await backend.data();assert.equal(d.work.find(w=>w.id==='w0').urgency,'紧急');assert.equal(d.work.find(w=>w.id==='w4').urgency,'急');
 await backend.saveWork({id:'w0',name:'事项0',projects:['甲'],note:'仅改备注'});
 d=await backend.data();assert.equal(d.work.find(w=>w.id==='w0').urgency,'紧急');assert.equal(d.work.find(w=>w.id==='w0').note,'仅改备注');
 const other=(await store.db.query("select urgency from work_items where owner_id=$1 and item_id='other'",[B])).rows[0];assert.equal(other.urgency,'正常');
 await store.db.exec(await readFile('supabase/migrations/20261028064722_work_item_urgency.sql','utf8'));
 assert.equal((await backend.data()).work.find(w=>w.id==='w0').urgency,'紧急');
 const fresh=await backend.saveWork({name:'新增正常事项',projects:[]});assert.equal((await backend.data()).work.find(w=>w.id===fresh.id).urgency,'正常');
});
test('project rename and merge do not change the linked work item urgency',async()=>{
 await backend.projectAdd('紧源','筹备');await backend.projectAdd('目标','在营');
 await backend.saveWork({id:'w0',name:'事项0',projects:['紧源','甲'],urgency:'紧急'});
 await backend.taxonomyManage('project','rename','紧源','紧新');
 let w=(await backend.data()).work.find(w=>w.id==='w0');assert(w.projects.includes('紧新'));assert.equal(w.urgency,'紧急');
 await backend.taxonomyManage('project','merge','紧新','目标');
 w=(await backend.data()).work.find(w=>w.id==='w0');assert(w.projects.includes('目标'));assert.equal(w.urgency,'紧急');
});
