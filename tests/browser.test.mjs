import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {Store,A} from './helpers/store.js';
let browser,server,url;
before(async()=>{
 server=createServer(async(req,res)=>{try{const file=new URL(req.url,'http://test').pathname.slice(1)||'index.html';if(file.includes('..'))throw Error('invalid path');res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':'text/javascript; charset=utf-8');res.end(await readFile(file));}catch{res.statusCode=404;res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));url='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
});
after(async()=>{await browser?.close();await new Promise(resolve=>server.close(resolve));});
async function open(t,viewport={width:1280,height:800}){
 const store=await Store.create();await store.seed();const page=await browser.newPage({viewport});
 const state={failSteps:false};const errors=[];page.on('pageerror',e=>errors.push(e.message));
 t.after(async()=>{await page.close();await store.close();assert.deepEqual(errors,[]);});
 await page.exposeFunction('sqlRequest',s=>state.failSteps&&s.action==='upsert'&&s.table==='work_steps'?{data:null,error:{message:'测试保存失败'}}:store.request(s,A));
 await page.route('**/config.js',route=>route.fulfill({contentType:'text/javascript',body:"export const SUPABASE_URL='https://test.invalid';export const SUPABASE_PUBLISHABLE_KEY='test-public';"}));
 await page.route('https://cdn.jsdelivr.net/**',route=>route.fulfill({contentType:'text/javascript',body:`import {makeClient} from '${url}/tests/helpers/client.js';export const createClient=()=>makeClient(spec=>window.sqlRequest(spec),()=>'${A}');`}));
 await page.goto(url);await page.waitForFunction(()=>document.getElementById('loadStatus').classList.contains('ok'));
 return {page,store,state};
}
const ids=(page,prefix)=>page.locator('#'+prefix+'Cards .card').evaluateAll(es=>es.map(e=>e.dataset.workId));
const frame=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const save=async page=>{await page.getByRole('button',{name:'保存事项及工作步骤',exact:true}).click();};
async function edit(page,prefix,id){const button=page.locator(`#${prefix}Cards [data-work-id="${id}"] button`);await button.scrollIntoViewIfNeeded();const y=await page.evaluate(()=>scrollY);await button.click();await page.waitForSelector('#editor.active');return y;}
test('actual Supabase page shows state views and stacks filters with linked project status',async t=>{
 const {page}=await open(t);assert.equal(await page.locator('#home h2').textContent(),'工作操作台');assert.equal((await ids(page,'home')).length,10);
 for(const [mode,count,status] of [['all',40,null],['done',10,'已完成'],['paused',10,'暂停'],['open',10,'进行中']]){
  await page.locator(`[data-mode="${mode}"]`).click();assert.equal((await ids(page,'home')).length,count);
  if(status)assert((await page.locator('#homeCards .work-status').allTextContents()).every(s=>s===status));
 }
 for(const prefix of ['home','all']){
  if(prefix==='all')await page.locator('.nav [data-page="all"]').click();else await page.locator('[data-mode="all"]').click();
  await page.selectOption('#'+prefix+'Project','乙');await page.selectOption('#'+prefix+'Phase','筹备');await page.selectOption('#'+prefix+'Category','采购');
  assert.equal((await ids(page,prefix)).length,27);
  await page.fill('#'+prefix+'Search','事项24');assert.deepEqual(await ids(page,prefix),['w24']);
  await page.selectOption('#'+prefix+'Project','甲');assert.deepEqual(await ids(page,prefix),[]);
 }
});
test('status is prominent, percentages removed and step-free items remain valid',async t=>{
 const {page}=await open(t);const card=page.locator('#homeCards [data-work-id="w0"]');
 assert.equal(await card.locator('.work-status').textContent(),'进行中');assert.equal(await card.locator('.work-status').evaluate(el=>getComputedStyle(el).fontSize),'22px');
 assert(!/待规划|\d+%/.test(await card.textContent()));assert.equal(await card.locator('.progress').getAttribute('aria-label'),'未拆分步骤');
 await page.locator('[data-mode="done"]').click();assert.equal(await page.locator('#homeCards .progress > div').first().evaluate(el=>el.style.width),'100%');
});
test('categories, notes and current progress save through the real adapter and SQL without losing multi-project links',async t=>{
 const {page,store}=await open(t);
 const preview=page.locator('#homeCards [data-work-id="w24"] .step-preview');
 assert.match(await preview.textContent(),/当前进展核价/);
 assert(!/当前工作步骤|进展说明/.test(await preview.textContent()));
 assert.equal((await preview.textContent()).match(/核价/g)?.length,1);
 await edit(page,'home','w4');
 assert.equal(await page.locator('#workProgress').count(),0);
 assert.equal(await page.locator('#currentProgress').textContent(),'尚未记录');
 await page.locator('#workCategories input[value="采购"]').check();await page.fill('#workNote','新的长期备注');
 await page.waitForFunction(()=>document.getElementById('sopMatches').textContent.includes('采购模板'));
 const context=await page.evaluate(()=>contextObj());
 assert.equal(context.projects.length,2);assert.equal(context.progress,'尚未记录');assert.equal(context.note,'新的长期备注');
 assert.equal(Object.hasOwn(context,'progressDetail'),false);
 assert.equal(await page.locator('#currentProgress').textContent(),'尚未记录');
 await save(page);await page.waitForSelector('#home.active');
 const row=(await store.db.query("select category_names,notes,confidence,latest_progress from work_items where owner_id=$1 and item_id='w4'",[A])).rows[0];
 assert.deepEqual(row.category_names,['合同','采购']);assert.equal(row.notes,'新的长期备注');assert.equal(row.confidence,'已核实');assert.equal(row.latest_progress,'进展说明');
 const savedPreview=page.locator('#homeCards [data-work-id="w4"] .step-preview');
 assert.match(await savedPreview.textContent(),/当前进展尚未记录备注：新的长期备注/);
 await edit(page,'home','w24');assert.equal(await page.locator('#currentProgress').textContent(),'核价');
 assert.equal((await page.evaluate(()=>contextObj())).progress,'核价');
 await page.fill('#workNote','核价相关备注');assert.equal(await page.locator('#currentProgress').textContent(),'核价');
 await page.locator('#stepsEditor select').first().selectOption('已完成');assert.equal(await page.locator('#currentProgress').textContent(),'待开始下一步');
 await save(page);await page.waitForSelector('#home.active');assert.equal((await store.db.query("select state from work_steps where step_id='s24b'")).rows[0].state,'待完成');
 assert.equal((await store.db.query("select latest_progress,notes from work_items where owner_id=$1 and item_id='w24'",[A])).rows[0].latest_progress,'进展说明');
 await edit(page,'home','w24');assert.equal(await page.locator('#currentProgress').textContent(),'待开始下一步');assert.equal(await page.inputValue('#workNote'),'核价相关备注');
 await page.locator('#stepsEditor select').nth(1).selectOption('进行中');assert.equal(await page.locator('#currentProgress').textContent(),'签署');
});
test('return/cancel/save preserve filters, status selection, expanded steps and viewport on both lists',async t=>{
 const {page}=await open(t);
 for(const prefix of ['home','all']){
  if(prefix==='all')await page.locator('.nav [data-page="all"]').click();
  await page.selectOption('#'+prefix+'Project','乙');await page.selectOption('#'+prefix+'Phase','筹备');
  if(prefix==='all')await page.selectOption('#allStatus','进行中');
  await page.locator(`#${prefix}Cards [data-work-id="w24"] summary`).click();
  for(const action of ['返回','取消','保存事项及工作步骤']){
   const y=await edit(page,prefix,'w24');assert(y>500);await page.getByRole('button',{name:action,exact:true}).click();await page.waitForSelector('#'+prefix+'.active');await frame(page);
   assert.equal(await page.inputValue('#'+prefix+'Project'),'乙');assert.equal(await page.inputValue('#'+prefix+'Phase'),'筹备');
   assert(Math.abs((await page.evaluate(()=>scrollY))-y)<3);assert(await page.locator(`#${prefix}Cards [data-work-id="w24"] details`).evaluate(el=>el.open));
  }
 }
});
test('item leaving a filter returns nearby; failed save stays editable and can be retried',async t=>{
 const {page,state}=await open(t);await edit(page,'home','w24');state.failSteps=true;
 await page.selectOption('#workStatus','已完成');await save(page);await page.waitForFunction(()=>document.getElementById('toast').textContent.includes('保存失败'));
 assert(await page.locator('#editor').evaluate(el=>el.classList.contains('active')));state.failSteps=false;await save(page);await page.waitForSelector('#home.active');await frame(page);
 assert(!(await ids(page,'home')).includes('w24'));assert(await page.evaluate(()=>scrollY)>500);
});
test('management entry below GPT supports project status, disable and preserved historical associations',async t=>{
 const {page}=await open(t);page.on('dialog',d=>d.accept());
 const nav=await page.locator('.nav button').allTextContents();assert(nav.indexOf('✦ GPT 工作同步')<nav.indexOf('工作管理要素整理'));
 await page.locator('.nav [data-page="taxonomy"]').click();await page.selectOption('#taxKind','project');await page.selectOption('#taxOld','乙');
 await page.selectOption('#taxAction','phase');await page.selectOption('#taxPhase','平台');await page.getByRole('button',{name:'确认执行',exact:true}).click();
 await page.waitForFunction(()=>document.getElementById('homePhase').textContent.includes('平台'));
 await page.selectOption('#taxOld','乙');await page.selectOption('#taxAction','disable');await page.getByRole('button',{name:'确认执行',exact:true}).click();await page.waitForFunction(()=>document.getElementById('taxItems').textContent.includes('停用'));
 await page.locator('.nav [data-page="home"]').click();await edit(page,'home','w0');assert.equal(await page.locator('#workProjects input:checked').count(),2);
 await page.getByRole('button',{name:'取消',exact:true}).click();await page.locator('header button.primary').click();assert.equal(await page.locator('#workProjects input[value="乙"]').count(),0);
});
test('GPT sync still lists every linked project and mobile lists have no horizontal overflow',async t=>{
 const {page}=await open(t,{width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.locator('.nav [data-page="sync"]').click();await page.waitForFunction(()=>document.getElementById('syncItem').options.length>1);
 const label=await page.locator('#syncItem option[value="w0"]').textContent();assert(label.includes('甲')&&label.includes('乙'));
 await page.locator('.nav [data-page="home"]').click();await edit(page,'home','w0');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
});


test('steps can move up and down, retain their identity and dates, and persist only when saved',async t=>{
 const {page,store}=await open(t,{width:390,height:844});
 await store.db.query("update work_steps set state='已完成',finished_date='2026-10-25',reminders='签署提示',required_docs='签署材料',risk_notes='签署风险' where step_id='s24b'");
 await store.db.query("insert into work_steps(owner_id,step_id,item_id,ordinal,title,state) values($1,'s24c','w24',3,'归档','待完成')",[A]);
 await page.getByRole('button',{name:'刷新',exact:true}).click();await page.waitForFunction(()=>document.getElementById('loadStatus').classList.contains('ok'));
 await edit(page,'home','w24');
 const row=i=>page.locator('#stepsEditor .step-item').nth(i);
 assert(await row(0).getByRole('button',{name:'上移第1步',exact:true}).isDisabled());
 assert(await row(2).getByRole('button',{name:'下移第3步',exact:true}).isDisabled());
 await row(0).locator('textarea').fill('核价更新');
 await row(0).getByRole('button',{name:'下移第1步',exact:true}).click();
 assert.deepEqual(await page.locator('#stepsEditor textarea').evaluateAll(es=>es.map(e=>e.value)),['签署','核价更新','归档']);
 assert.equal(await page.locator('#currentProgress').textContent(),'核价更新');
 assert.equal(await row(0).getByLabel('实际完成日期').inputValue(),'2026-10-25');
 assert.match(await row(0).textContent(),/签署提示/);assert.match(await row(0).textContent(),/签署材料/);assert.match(await row(0).textContent(),/签署风险/);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await save(page);await page.waitForSelector('#home.active');
 const saved=(await store.db.query("select step_id,ordinal,title,state,finished_date::text,reminders,required_docs,risk_notes from work_steps where item_id='w24' order by ordinal")).rows;
 assert.deepEqual(saved.map(s=>[s.step_id,s.ordinal,s.title,s.state]),[['s24b',1,'签署','已完成'],['s24a',2,'核价更新','进行中'],['s24c',3,'归档','待完成']]);
 assert.equal(saved[0].finished_date,'2026-10-25');assert.equal(saved[0].reminders,'签署提示');assert.equal(saved[0].required_docs,'签署材料');assert.equal(saved[0].risk_notes,'签署风险');
 await edit(page,'home','w24');assert.deepEqual(await page.locator('#stepsEditor textarea').evaluateAll(es=>es.map(e=>e.value)),['签署','核价更新','归档']);
 await row(1).getByRole('button',{name:'上移第2步',exact:true}).focus();await page.keyboard.press('Enter');
 assert.equal(await row(0).locator('textarea').inputValue(),'核价更新');
 assert.equal(await page.locator('#currentProgress').textContent(),'核价更新');
 await page.getByRole('button',{name:'取消',exact:true}).click();await page.waitForSelector('#home.active');
 await edit(page,'home','w24');assert.deepEqual(await page.locator('#stepsEditor textarea').evaluateAll(es=>es.map(e=>e.value)),['签署','核价更新','归档']);
 assert.equal(await row(0).getByLabel('实际完成日期').inputValue(),'2026-10-25');
});

test('work item urgency persists, orders home cards and respects filters without saving cancelled changes',async t=>{
 const {page,store}=await open(t);
 assert.equal(await page.locator('#taxUrgency').count(),0);
 await page.locator('header button.primary').click();assert.equal(await page.inputValue('#workUrgency'),'正常');
 await page.getByRole('button',{name:'取消',exact:true}).click();await page.waitForSelector('#home.active');
 const setUrgency=async(id,urgency)=>{
  await edit(page,'home',id);await page.selectOption('#workUrgency',urgency);await save(page);await page.waitForSelector('#home.active');
 };
 await setUrgency('w8','紧急');await setUrgency('w16','紧急');await setUrgency('w4','急');await setUrgency('w12','正常');
 const underlying=await page.evaluate(()=>DB.work.filter(work=>work.status==='进行中').map(work=>work.id));
 const urgent=new Set(['w8','w16']);
 const expected=[...underlying.filter(id=>urgent.has(id)),...underlying.filter(id=>id==='w4'),...underlying.filter(id=>!urgent.has(id)&&id!=='w4')];
 assert.deepEqual(await ids(page,'home'),expected);
 for(const [id,urgency] of [['w8','紧急'],['w16','紧急'],['w4','急'],['w12','正常']])assert.equal(await page.locator(`#homeCards [data-work-id="${id}"] .urgency-badge`).textContent(),urgency);
 await page.selectOption('#homeProject','乙');await page.selectOption('#homePhase','筹备');await page.selectOption('#homeCategory','采购');
 const categoryMatches=await page.evaluate(()=>DB.work.filter(work=>work.status==='进行中'&&work.categories.includes('采购')).map(work=>work.id));
 assert.deepEqual(await ids(page,'home'),expected.filter(id=>categoryMatches.includes(id)));
 await page.fill('#homeSearch','事项12');assert.deepEqual(await ids(page,'home'),['w12']);
 await page.fill('#homeSearch','');await page.selectOption('#homeProject','');await page.selectOption('#homePhase','');await page.selectOption('#homeCategory','');
 for(const mode of ['done','paused']){await page.locator(`[data-mode="${mode}"]`).click();assert.equal((await ids(page,'home')).length,10);}
 await page.locator('[data-mode="open"]').click();assert.deepEqual(await ids(page,'home'),expected);
 await edit(page,'home','w8');assert.equal(await page.inputValue('#workUrgency'),'紧急');
 await page.selectOption('#workUrgency','正常');await page.getByRole('button',{name:'取消',exact:true}).click();await page.waitForSelector('#home.active');
 assert.deepEqual(await ids(page,'home'),expected);
 await edit(page,'home','w8');assert.equal(await page.inputValue('#workUrgency'),'紧急');
 await page.getByRole('button',{name:'取消',exact:true}).click();await page.waitForSelector('#home.active');
 const saved=(await store.db.query("select item_id,urgency from work_items where owner_id=$1 and item_id in ('w8','w16','w4','w12') order by item_id",[A])).rows;
 assert.deepEqual(saved.map(work=>[work.item_id,work.urgency]),[['w12','正常'],['w16','紧急'],['w4','急'],['w8','紧急']]);
 await page.reload();await page.waitForFunction(()=>document.getElementById('loadStatus').classList.contains('ok'));
 assert.deepEqual(await ids(page,'home'),expected);
 await edit(page,'home','w4');assert.equal(await page.inputValue('#workUrgency'),'急');
});
