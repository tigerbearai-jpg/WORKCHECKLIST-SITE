// Test-only Supabase query transport; production never imports this module.
export function makeClient(request,getUser){
 class Query{
  constructor(table){this.spec={table,action:'select',filters:[]};}
  select(columns='*'){this.spec.columns=columns;return this;}
  eq(column,value){this.spec.filters.push({column,value});return this;}
  in(column,value){this.spec.filters.push({column,value,in:true});return this;}
  range(start,end){this.spec.range=[start,end];return this;}
  insert(rows){this.spec.action='insert';this.spec.rows=rows;return this;}
  upsert(rows,options){this.spec.action='upsert';this.spec.rows=rows;this.spec.conflict=options.onConflict;return this;}
  update(values){this.spec.action='update';this.spec.values=values;return this;}
  delete(){this.spec.action='delete';return this;}
  then(resolve,reject){return request(this.spec).then(resolve,reject);}
 }
 return {from:table=>new Query(table),rpc:(fn,args)=>request({action:'rpc',fn,args}),auth:{
  getUser:async()=>({data:{user:getUser()?{id:getUser()}:null},error:null}),
  getSession:async()=>({data:{session:getUser()?{user:{id:getUser()}}:null},error:null}),
  onAuthStateChange(){},signOut:async()=>({error:null})
 }};
}
