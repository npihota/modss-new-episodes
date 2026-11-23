const test=require('node:test');const assert=require('node:assert/strict');
const adapter=require('../src/adapter.js');
function makeLampa(replies){
 const instances=[], calls=[];
 function Component(object){
  this.object=object;instances.push(this);
  this.initialize=()=>assert.fail('must not initialize a background component');
  this.destroy=()=>assert.fail('MODS destroy alters global player/cache state');
  this.reset=()=>{this.resetCount=(this.resetCount||0)+1;};
  this.render=()=>({remove:()=>{this.removed=true;}});
  this.requestParams=url=>url+(url.includes('?')?'&':'?')+'test_session=value';
  this.createSource=()=>{this.BalLocal({kodik:{url:'https://api.lampa.stream/on/kodik',name:'Kodik'},alloha:{url:'https://api.lampa.stream/on/alloha',name:'Alloha'}});return Promise.resolve();};
  this.request=url=>{calls.push(url);const key=new URL(url).pathname;const payload=replies[key];setImmediate(()=>payload instanceof Error?this.doesNotAnswer(payload):this.parse(payload));};
 }
 return {Component:{get:()=>Component},instances,calls};
}
function api(name){assert.equal(typeof adapter[name],'function',name+' must be implemented');return adapter[name];}
test('session bridge fetches subscriptions without navigating or initializing MODS',async()=>{
 const L=makeLampa({'/subscr/mysubscr':{success:true,subscriptions:[{movie_id:5,voice:'AniStar',title:'Series',card:JSON.stringify({id:5,source:'tmdb',name:'Series'})}]}});
 const service=api('create')(L,{delay:0,timeout:500});const subs=await service.subscriptions();
 assert.equal(subs.length,1);assert.equal(subs[0].voice,'AniStar');assert.equal(subs[0].movie.id,5);
 assert.equal(L.instances[0].resetCount,1);assert.equal(L.instances[0].removed,true);
});
test('scan traverses target voice URL and merges actual episodes from multiple sources',async()=>{
 const L=makeLampa({
  '/on/kodik':{voice:[{title:'AniStar',url:'https://api.lampa.stream/on/target'}]},
  '/on/target':{folder:{1:[{episode:167,url:'https://example.invalid/stream'}]}},
  '/on/alloha':{folder:{AniStar:{1:[{episode:167,url:'https://example.invalid/stream'},{episode:166,url:'https://example.invalid/stream'}]}}}
 });
 const result=await api('create')(L,{delay:0,timeout:500}).scan({voice:'AniStar',movie:{id:5,name:'Series',source:'tmdb'}});
 assert.equal(result.rows.length,2);assert.equal(result.rows.find(x=>x.episode===167).sources.length,2);assert.equal(result.partial,false);
 assert.ok(!L.calls.some(x=>x.includes('example.invalid')));
});
test('failed source retains its previous confirmed episodes and marks scan partial',async()=>{
 const L=makeLampa({'/on/kodik':new Error('offline'),'/on/alloha':{folder:{AniStar:{1:[{episode:167,url:'https://example.invalid/a'}]}}}});
 const previous=[{key:'tmdb:tv:5:1:168',show:'tmdb:tv:5',movie:{id:5,name:'Series',source:'tmdb'},season:1,episode:168,voice:'AniStar',sources:[{slug:'kodik',title:'Kodik'}]}];
 const result=await api('create')(L,{delay:0,timeout:500}).scan({voice:'AniStar',movie:{id:5,name:'Series',source:'tmdb'}},previous);
 assert.deepEqual(result.rows.map(x=>x.episode).sort(),[167,168]);assert.equal(result.partial,true);
});
test('expired/denied payload produces a generic error and never exposes response secrets',async()=>{
 const L=makeLampa({'/subscr/mysubscr':{error:true,uid:'secret-value',message:'secret-value'}});
 await assert.rejects(()=>api('create')(L,{delay:0,timeout:500}).subscriptions(),e=>e.code==='MODS_DENIED'&&!String(e).includes('secret-value'));
});
test('unknown response does not become an empty successful scan',async()=>{
 const L=makeLampa({'/on/kodik':{unexpected:true},'/on/alloha':{unexpected:true}});
 const result=await api('create')(L,{delay:0,timeout:500}).scan({voice:'AniStar',movie:{id:5,name:'Series',source:'tmdb'}});
 assert.equal(result.partial,true);assert.equal(result.errors.length,2);
});
test('abort cancels pending bridge and releases its detached DOM',async()=>{
 const L=makeLampa({});const service=api('create')(L,{timeout:25,delay:0});
 const p=service.subscriptions();service.abort();await assert.rejects(p,e=>e.code==='CANCELLED');
 assert.equal(L.instances[0].resetCount,1);
});
test('foreign navigation URL is rejected before credentials can be appended',async()=>{
 const L=makeLampa({});const service=api('create')(L,{timeout:25,delay:0});
 await assert.rejects(()=>service.request({id:5,name:'Series'},'https://example.invalid/steal'),e=>e.code==='UNSAFE_URL');
 assert.equal(L.calls.length,0);
});
test('only failed source credits survive from a merged cached episode',async()=>{
 const L=makeLampa({'/on/kodik':new Error('offline'),'/on/alloha':{folder:{AniStar:{1:[]}}}});
 const previous=[{key:'tmdb:tv:5:1:168',show:'tmdb:tv:5',movie:{id:5,name:'Series',source:'tmdb'},season:1,episode:168,voice:'AniStar',sources:[{slug:'kodik'},{slug:'alloha'}]}];
 const result=await adapter.create(L,{delay:0,timeout:500}).scan({voice:'AniStar',movie:previous[0].movie},previous);
 assert.deepEqual(result.rows[0].sources.map(x=>x.slug),['kodik']);
});
test('empty discovery preserves previous successful episodes as partial',async()=>{
 const L=makeLampa({}),C=L.Component.get();L.Component.get=()=>function(o){const c=new C(o);c.createSource=()=>{c.BalLocal({});return Promise.resolve();};return c;};
 const previous=[{key:'a',show:'tmdb:tv:5',movie:{id:5,name:'Series'},season:1,episode:167,voice:'AniStar',sources:[{slug:'kodik'}]}];
 const result=await adapter.create(L,{delay:0,timeout:500}).scan({voice:'AniStar',movie:previous[0].movie},previous);
 assert.equal(result.rows.length,1);assert.equal(result.partial,true);
});
test('scan stops before a next page when visibility or playback eligibility changes',async()=>{
 let allowed=true;const L=makeLampa({'/on/kodik':{voice:[{title:'AniStar',url:'https://api.lampa.stream/on/page2'}]},'/on/page2':{folder:{AniStar:{1:[]}}},'/on/alloha':{folder:{}}});
 const C=L.Component.get();L.Component.get=()=>function(o){const c=new C(o),request=c.request;c.request=url=>{request(url);if(new URL(url).pathname==='/on/kodik')allowed=false;};return c;};
 await assert.rejects(()=>adapter.create(L,{delay:0,timeout:500,shouldContinue:()=>allowed}).scan({voice:'AniStar',movie:{id:5,name:'Series'}}),e=>e.code==='CANCELLED');
 assert.ok(!L.calls.some(x=>x.includes('/page2')));
});
test('discovery waits for the last live source update before scanning',async()=>{
 const L=makeLampa({'/on/kodik':{folder:{AniStar:{1:[{episode:1,url:'x'}]}}},'/on/alloha':{folder:{AniStar:{1:[{episode:2,url:'x'}]}}}});
 const C=L.Component.get();L.Component.get=()=>function(o){const c=new C(o);c.lifeSource=()=>Promise.resolve();c.createSource=()=>{c.lifeSource();c.BalLocal({kodik:{url:'https://api.lampa.stream/on/kodik'}});setTimeout(()=>{c.BalLocal({kodik:{url:'https://api.lampa.stream/on/kodik'},alloha:{url:'https://api.lampa.stream/on/alloha'}});c.tellLiveScreen(true);},15);return Promise.resolve();};return c;};
 const result=await adapter.create(L,{delay:0,timeout:500}).scan({voice:'AniStar',movie:{id:5,name:'Series'}});
 assert.deepEqual(result.rows.map(x=>x.episode).sort(),[1,2]);
});
module.exports={makeLampa};
