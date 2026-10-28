// Shared display rules; no database or authentication side effects.
export function categoryNames(value,legacy=''){
 const names=Array.isArray(value)&&value.length?value:(legacy?[legacy]:[]);
 return [...new Set(names.map(String).map(x=>x.trim()).filter(Boolean))];
}
export function currentProgress(steps){
 const applicable=steps.filter(x=>x.status!=='不适用'&&String(x.text||'').trim());
 if(!applicable.length)return '暂无进行中步骤';
 const active=applicable.filter(x=>x.status==='进行中');
 const title=active.length?active.map(x=>x.text).join('；'):applicable.every(x=>x.status==='已完成')?'全部步骤已完成':'待开始下一步';
 return title;
}
export function filterWork(work,filters){
 const keyword=(filters.search||'').trim().toLowerCase();
 return work.filter(w=>{
  if(w.status==='已删除')return false;
  const categories=categoryNames(w.categories,w.category);
  const projects=w.projectDetails||[];
  const matchingProjects=filters.project?projects.filter(p=>p.name===filters.project):projects;
  return (!keyword||[w.name,w.project,w.progress,...categories].join(' ').toLowerCase().includes(keyword))&&
   (!filters.category||categories.includes(filters.category))&&
   (!filters.project||matchingProjects.length>0)&&
   (!filters.phase||matchingProjects.some(p=>p.phase===filters.phase))&&
   (!filters.status||w.status===filters.status);
 });
}
