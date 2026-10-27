import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {Store,A,B} from './helpers/store.js';
import {makeClient} from './helpers/client.js';
import {categoryNames,currentProgress,filterWork} from '../work-model.js';
let store,backend;
before(async()=>{
 store=await Store.create();await store.seed();
 const db=makeClient(s=>store.request(s,A),()=>A);
 const source=(await readFile('supabase-adapter.js','utf8')).replace(/^import .*;\n/gm,'').replace(/^export \{ db \};/gm,'');
 const context=vm.createContext({createClient:()=>db,SUPABASE_URL:'https://test.invalid',SUPABASE_PUBLISHABLE_KEY:'test-public',currentProgress,categoryNames,filterWork,window:{},document:{addEventListener(){},getElementById(){return null}},TextEncoder,btoa,crypto:globalThis.crypto,console});
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
 assert.equal(currentProgress([{text:'核价',status:'进行中'},{text:'审批',status:'进行中'}],'等反馈'),'核价；审批｜等反馈');
 assert.equal(currentProgress([{text:'签署',status:'待完成'}]),'待开始下一步');
 assert.equal(currentProgress([],'手动说明'),'手动说明');
 const d=await backend.data(),w=d.work.find(x=>x.id==='w24');assert.equal(w.projects.length,2);assert.equal(w.progress,'核价｜进展说明');
 assert.equal(filterWork([w],{project:'乙',phase:'筹备',category:'采购'}).length,1);
 assert.equal(filterWork([w],{project:'甲',phase:'筹备'}).length,0,'phase must belong to the selected project');
});
test('save multi-category and notes without losing projects, confidence, SOP or followup',async()=>{
 await store.db.query("update work_items set sop_id='original',followup_status='跟进' where owner_id=$1 and item_id='w4'",[A]);
 await backend.saveWork({id:'w4',name:'事项4',categories:['合同','采购'],projects:['甲','乙'],note:'新备注',progress:'补充说明'});
 const row=(await store.db.query("select * from work_items where owner_id=$1 and item_id='w4'",[A])).rows[0];
 assert.deepEqual(row.category_names,['合同','采购']);assert.equal(row.notes,'新备注');assert.equal(row.confidence,'已核实');assert.equal(row.sop_id,'original');assert.equal(row.followup_status,'跟进');
 assert.equal((await backend.data()).work.find(x=>x.id==='w4').projects.length,2);
 assert.equal((await backend.matchSop(['合同','采购'],'事项')).length,2);
 assert((await backend.historyQuery({mode:'all',category:'采购'})).rows.some(x=>x.id==='w4'));
});
test('step completion retains history and never starts the next step',async()=>{
 await backend.saveSteps('w24',[{id:'s24a',text:'核价',status:'已完成',completedAt:'2026-10-27'},{id:'s24b',text:'签署',status:'待完成'}]);
 const w=(await backend.data()).work.find(w=>w.id==='w24');assert.equal(w.progress,'待开始下一步｜进展说明');assert.equal(w.steps[1].status,'待完成');
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
