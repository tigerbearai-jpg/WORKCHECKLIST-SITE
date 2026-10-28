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
