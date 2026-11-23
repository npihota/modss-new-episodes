const test=require('node:test');const assert=require('node:assert/strict');const plugin=require('../src/plugin.js');
test('episode subscription uses current voice and never selects the unsubscribe action',()=>{
 assert.equal(typeof plugin.subscriptionChoice,'function');
 const target={voice_data:{voice_name:'AniStar'},title:'AniStar'};
 assert.equal(plugin.subscriptionChoice([{unsubscribe_action:true,voice_data:{voice_name:'Anistar'}},target],'Anistar'),target);
 assert.equal(plugin.subscriptionChoice([target],'AnimeVost'),null);
});
test('series subscription button delegates to MODS voice picker once and invalidates feed',()=>{
 assert.equal(typeof plugin.mountSubscribeButton,'function');
 let exists=false,handler,triggered=0,invalidated=0,loading=false;
 const btn={length:1,on(name,fn){handler=fn;return this;}};
 const online={length:1,hasClass(){return loading;},trigger(name){assert.equal(name,'hover:long');triggered++;},after(){exists=true;}};
 const area={find(s){return s==='.mnef-subscribe'?{length:exists?1:0}:online;}};
 const L={Activity:{active:()=>({component:'full',activity:{render:()=>area}})},Noty:{show(){}}};
 const $=()=>btn;
 plugin.mountSubscribeButton(L,$,{id:5,name:'Series',number_of_seasons:1},()=>invalidated++);
 handler();assert.equal(triggered,1);assert.equal(invalidated,1);
 loading=true;handler();assert.equal(triggered,1);
 assert.equal(plugin.mountSubscribeButton(L,$,{id:5,name:'Series'},()=>{}),false);
 exists=false;assert.equal(plugin.mountSubscribeButton(L,$,{id:9,title:'Movie',release_date:'2025-01-01'},()=>{}),false);
});
function api(name){assert.equal(typeof plugin[name],'function',name+' must be implemented');return plugin[name];}
test('new episode row is exactly second, directly below Сейчас смотрят, and never duplicated',()=>{
 const watching={title:'Сейчас смотрят',results:[]}, rest={title:'Рекомендуем посмотреть',results:[]}, feed={title:'Новые серии',mnef:true,results:[]};
 const data=api('insertRow')([watching,rest],feed);
 assert.equal(data[0],watching);assert.equal(data[1],feed);assert.equal(data[2],rest);
 assert.equal(plugin.insertRow(data,feed).filter(x=>x.mnef).length,1);
});
test('home rows fallback to second position when the localized title is unavailable',()=>{
 const rows=api('insertRow')([{title:'Now watching'},{title:'Trending'}],{mnef:true});assert.equal(rows[1].mnef,true);
});
test('automatic refresh is restricted to visible main and never playback',()=>{
 const allowed=api('mayRefresh');assert.equal(allowed({component:'main'},false,'visible'),true);
 assert.equal(allowed({component:'main'},true,'visible'),false);assert.equal(allowed({component:'full'},false,'visible'),false);
 assert.equal(allowed({component:'main'},false,'hidden'),false);
});
test('manual viewed/unviewed uses standard Lampa Timeline and preserves timing',()=>{
 const writes=[];const timeline={hash:8,percent:35,time:100,duration:300,handler:()=>{}};
 const L={Utils:{hash:()=>8},Timeline:{view:()=>timeline,link:()=>({card:'tv_5',season:1,episode:3}),update:v=>writes.push(v)}};
 const row={movie:{id:5,name:'Series',original_name:'Series'},season:1,episode:3};
 api('markEpisode')(L,row,true);plugin.markEpisode(L,row,false);
 assert.deepEqual(writes.map(x=>x.percent),[100,0]);assert.equal(writes[0].time,100);assert.equal(writes[0].duration,300);
 assert.equal(writes[1].time,0);assert.equal('handler' in writes[0],false);assert.equal(writes[0].card,'tv_5');
});
test('episode timeline resolves both original_title and original_name for MODS compatibility',()=>{
 const hashes=[];const L={Utils:{hash:s=>{hashes.push(s);return s;}},Timeline:{view:(h)=>({percent:h.includes('Old Title')?95:0}),link:()=>({card:'tv_5'})}};
 const progress=api('progressFor')(L,{movie:{id:5,original_title:'Old Title',original_name:'New Title'},season:1,episode:3});
 assert.equal(progress.percent,95);assert.equal(hashes.length,2);
});
test('episode card has concrete season and episode; placeholder has no fake subscription',()=>{
 const row={movie:{id:5,name:'Series'},season:2,episode:7,voice:'AniStar',sources:[{slug:'kodik'}]};
 const card=api('episodeCard')(row);assert.equal(card.mnef.episode,7);assert.equal(card.name,'Series');assert.ok(card.mnef);
 assert.equal(card.mnefCaption,'AniStar · kodik');
 const blank=plugin.statusCard('Новых серий пока нет');assert.equal(blank.mnefStatus,true);assert.equal(blank.mnef,undefined);
});
test('target season uses the actual MODS season list, not seasons with the chosen voice',()=>{
 const choice=api('targetChoice')({season:['Сезон 1','Сезон 2','Сезон 3']},{season:3,episode:7,voice:'AniStar'});
 assert.equal(choice.season,2);assert.equal(choice.voice_name,'AniStar');
});
test('all 167 watched episodes can be reached through pagination, including episode one',()=>{
 const rows=Array.from({length:167},(_,i)=>({episode:167-i}));
 const pages=api('pages')(rows,50);assert.deepEqual(pages.map(x=>x.length),[50,50,50,17]);assert.equal(pages[3][16].episode,1);
});
test('an old scan is not current after switching profiles A to B to A',()=>{
 const oldService={},newService={};
 assert.equal(api('currentScan')('A','A',oldService,newService,true),false);
 assert.equal(plugin.currentScan('A','A',newService,newService,true),true);
});
test('episode focus survives MODS own delayed initial focus and installer cleans its hooks',()=>{
 const originalSet=global.setTimeout,originalClear=global.clearTimeout;let now=0,nextId=0;const timers=new Map(),events={},docEvents={},storageEvents={};
 global.setTimeout=(fn,ms)=>{const id=++nextId;timers.set(id,{fn,at:now+ms});return id;};global.clearTimeout=id=>timers.delete(id);
 function advance(ms){const end=now+ms;for(;;){const due=[...timers.entries()].filter(([,x])=>x.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;now=due[1].at;timers.delete(due[0]);due[1].fn();}now=end;}
 const cards=[{se:'S1:E167'},{se:'S1:E165'}];let focused=cards[0],lastChoice;
 const comp={parse(){setTimeout(()=>{focused=cards[0];},400);},draw(){},destroy(){},replaceChoice(c){lastChoice=c;},episodeCards(){return {each(fn){cards.forEach(card=>fn.call(card));}};},episodesScroll(){return {render(){return {};}};},render(){return {};},scrollTo(){}};
 const params={component:'modss_online',activity:{component:comp},mnef_target:{season:1,episode:165,voice:'AniStar'}};
 const originals={main:function(){},modss_online:function(){}};const components={...originals};
 const listeners=()=>({follow(name,fn){events[name]=fn;},remove(name,fn){if(events[name]===fn)delete events[name];}});
 const $=value=>typeof value==='object'?{data(){return value.se;}}:{text(){return this;},appendTo(){return this;},remove(){}};
 const L={Component:{get:n=>components[n],add(n,c){components[n]=c;}},Storage:{get:(n,d)=>d,listener:{follow(n,fn){storageEvents[n]=fn;},remove(n){delete storageEvents[n];}}},Utils:{hash:()=>1},Activity:{active:()=>params},Player:{opened:()=>false},Listener:listeners(),Timeline:{listener:{follow(){},remove(){}}},Controller:{enable(){},collectionSet(){},collectionFocus(card){focused=card;}}};
 const root={Lampa:L,$,document:{visibilityState:'visible',addEventListener(n,fn){docEvents[n]=fn;},removeEventListener(n){delete docEvents[n];}},Navigator:{focus(card){focused=card;}}};
 let handle;
 try{
  handle=plugin.install(root);events.activity({component:'modss_online',type:'create',object:params});
  comp.parse({season:['Сезон 1']});advance(850);
  assert.equal(focused.se,'S1:E165');assert.equal(lastChoice.voice_name,'AniStar');
  handle.dispose();handle=null;assert.equal(components.main,originals.main);assert.equal(events.activity,undefined);assert.equal(docEvents.visibilitychange,undefined);assert.equal(comp._mnefTarget,false);
 }finally{if(handle)handle.dispose();global.setTimeout=originalSet;global.clearTimeout=originalClear;}
});
