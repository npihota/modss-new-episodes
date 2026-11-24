const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/core.js');
const ep = (n, voice, extra={}) => ({episode:n, voice_name:voice, url:'https://example.invalid/resolve/'+n, ...extra});
const context = {voice:'Anistar', source:'kodik', movie:{id:223911, source:'tmdb',name:'Противостояние святого'}};
test('HTTP source URLs from the same MODS API are upgraded instead of silently discarded',()=>{
 assert.equal(core.apiUrl('http://api.lampa.stream/on/kodik','https://api.lampa.stream/'),'https://api.lampa.stream/on/kodik');
 assert.equal(core.apiUrl('https://api.lampa.stream/on/kodik','http://api.lampa.stream/'),'https://api.lampa.stream/on/kodik');
 assert.equal(core.apiUrl('http://evil.invalid/on/kodik','https://api.lampa.stream/'),false);
});
test('all progress below 85 percent remains in new episodes',()=>{
 const rows=core.extractEpisodes({folder:{AniStar:{1:[ep(1),ep(2),ep(3),ep(4),ep(5)]}}},context);
 const percentages=[0,30,84.99,85,100];
 assert.deepEqual(core.buildFeed(rows,{progress:r=>({percent:percentages[r.episode-1]})}).map(r=>r.episode),[3,2,1]);
});
function api(name) { assert.equal(typeof core[name], 'function', name+' must be implemented'); return core[name]; }
test('sparse source lists do not invent missing episodes or use the subscription checkpoint', () => {
  const rows = api('extractEpisodes')({folder:{AniStar:{1:[ep(39),ep(114),ep(125)]}},episode_count:168},context);
  assert.deepEqual(rows.map(x=>x.episode),[39,114,125]);
  assert.ok(rows.every(x=>x.season===1 && x.voice==='Anistar'));
});
test('direct season mapping isolates selected voice and preserves season numbers', () => {
  const rows=api('extractEpisodes')({folder:{3:[ep(8,'AnimeVost'),ep(7,'AniStar'),ep(9,'Anistar2')]}},context);
  assert.deepEqual(rows.map(x=>[x.season,x.episode]),[[3,7]]);
});
test('voice ID descriptors identify otherwise unlabeled episode leaves',()=>{
  const rows=api('extractEpisodes')({voice:[{id:8,title:'AniStar'},{id:2,title:'AnimeVost'}],folder:{1:[ep(1,null,{voice_id:8}),ep(2,null,{voice_id:2})]}},context);
  assert.deepEqual(rows.map(x=>x.episode),[1]);
});
test('unknown voice is never accepted unless the requested voice branch was loaded',()=>{
  assert.equal(api('extractEpisodes')({folder:{1:[ep(1)]}},context).length,0);
  assert.equal(core.extractEpisodes({folder:{1:[ep(1)]}},{...context,confirmedVoice:'AniStar'}).length,1);
});
test('voice normalization accepts technical prefix/case and rejects another studio',()=>{
  assert.equal(api('sameVoice')('Anistar','MVO | AniStar [rus]'),true);
  assert.equal(core.sameVoice('Anistar','Анистар'),true);
  assert.equal(core.sameVoice('Anistar','Anistar2'),false);
  assert.equal(core.sameVoice('Anistar','AnimeVost'),false);
});
test('multiple audio tracks make the requested voice available',()=>{
  const rows=api('extractEpisodes')({folder:{1:[ep(5,null,{audio_tracks:[{label:'AnimeVost / 2'},{label:'AniStar / 2'}]})]}},context);
  assert.equal(rows.length,1);
});
test('voice and season navigation are followed only within the MODS API',()=>{
  const payload={voice:[{title:'AniStar',url:'https://api.lampa.stream/on/voices/8'},{title:'AnimeVost',url:'https://api.lampa.stream/on/voices/2'}],season:[{name:'Сезон 2',url:'https://api.lampa.stream/on/s2'}]};
  const links=api('navigation')(payload,context);
  assert.ok(links.some(x=>x.url.endsWith('/8') && x.confirmedVoice==='AniStar'));
  assert.ok(!links.some(x=>x.url.endsWith('/2')));
  assert.equal(core.navigation({voice:[{title:'AniStar',url:'https://evil.invalid/a'}]},context).length,0);
});
test('duplicate source entries merge without confusing seasons',()=>{
  const extract=api('extractEpisodes');
  const rows=api('mergeEpisodes')([extract({folder:{AniStar:{1:[ep(167)],2:[ep(1)]}}},context),extract({folder:{AniStar:{1:[ep(167)]}}},{...context,source:'alloha'})]);
  assert.equal(rows.length,2);
  assert.deepEqual(rows.find(x=>x.episode===167).sources.map(x=>x.slug).sort(),['alloha','kodik']);
});
test('85 percent is complete; started episodes stay; explicit unwatched overrides timeline',()=>{
  const rows=api('extractEpisodes')({folder:{AniStar:{1:[ep(1),ep(2),ep(3)]}}},context);
  const progress=x=>({percent:x.episode===1?85:x.episode===2?35:100});
  const manual={}; manual[rows[2].key]={watched:false};
  const feed=api('buildFeed')(rows,{progress,manual});
  assert.deepEqual(feed.map(x=>x.episode),[3,2]);
  assert.equal(feed[1].percent,35);
});
test('watched-through baseline includes earlier seasons but explicit unwatched wins',()=>{
  const rows=api('extractEpisodes')({folder:{AniStar:{1:[ep(167)],2:[ep(1),ep(2),ep(3)]}}},context);
  const baseline={}; baseline[core.showKey(context.movie)]={season:2,episode:2};
  const manual={};manual[rows[1].key]={watched:false};
  const feed=api('buildFeed')(rows,{baseline,manual,progress:()=>({percent:0})});
  assert.deepEqual(feed.map(x=>[x.season,x.episode]),[[2,3],[2,1]]);
});
test('profile-specific keys do not overlap and guest has no account identifiers',()=>{
  const key=api('storageKey');assert.notEqual(key('cache','p1'),key('cache','p2'));
  assert.equal(key('cache',null),'mnef_cache_guest');
});
test('cache snapshots strip resolver URLs, request headers and account fields',()=>{
  const rows=api('extractEpisodes')({folder:{AniStar:{1:[ep(167,null,{headers:{Authorization:'secret'},token:'secret'})]}}},context);
  const snapshot=api('snapshot')(rows,1000);const str=JSON.stringify(snapshot);
  assert.ok(!str.includes('secret')&&!str.includes('resolve/167'));
  assert.equal(snapshot.rows[0].sources[0].slug,'kodik');
});
test('an explicit other-studio folder overrides inherited confirmed voice',()=>{
 const payload={folder:{AniStar:{1:[ep(1)]},AnimeVost:{1:[ep(2)]}}};
 assert.deepEqual(core.extractEpisodes(payload,{...context,confirmedVoice:'AniStar'}).map(x=>x.episode),[1]);
});
test('signed artwork URLs are not persisted in rows or subscription cards',()=>{
 const movie={id:5,name:'Series',img:'https://example.invalid/a.jpg?token=test-secret',poster_path:'https://image.tmdb.org/t/p/w500/a.jpg?token=test-secret',backdrop_path:'/public.jpg'};
 const safe=core.safeMovie(movie);assert.ok(!JSON.stringify(safe).includes('test-secret'));assert.equal(safe.backdrop_path,'/public.jpg');
});
test('source labels exclude VIP badges and technical source counters',()=>{
 const rows=core.extractEpisodes({folder:{AniStar:{1:[ep(1)]}}},{...context,sourceTitle:'Kodik<span>VIP</span><b>6 | 1</b>'});
 assert.equal(rows[0].sources[0].title,'Kodik');
});
