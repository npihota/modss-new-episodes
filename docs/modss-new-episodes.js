/* MODS New Episodes v0.1.4 | Independent Lampa add-on | No embedded account data */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ModssEpisodesCore = factory();
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  var COMPLETION_PERCENT = 85;
  var owns = Object.prototype.hasOwnProperty;
  function positive(value) { var n = Number(value); return isFinite(n) && n > 0 && Math.floor(n) === n ? n : 0; }
  function normalizeVoice(value) {
    var s = String(value || '').replace(/<[^>]*>/g, ' ').toLowerCase();
    s = s.replace(/^(?:mvo|dvo|dub|vo|многоголосый|двухголосый|дублированный|закадровый)\s*[-|:]\s*/i, '');
    s = s.replace(/[\[(](?:rus|ru|eng|en|ukr|uk|hd|fhd|uhd|4k|\d{3,4}p?)[\])]/g, '');
    s = s.replace(/[\s\u200b-\u200f\ufeff._-]+/g, '');
    return s === 'анистар' ? 'anistar' : s;
  }
  function sameVoice(a, b) { var x = normalizeVoice(a); return !!x && x === normalizeVoice(b); }
  function showKey(movie) {
    var source = movie.source || 'tmdb';
    if (source === 'cub') source = 'tmdb';
    return source + ':tv:' + String(movie.id);
  }
  function storageKey(kind, profile) { return 'mnef_' + kind + '_' + String(profile || 'guest').replace(/[^a-zA-Z0-9_-]/g, '_'); }
  function safeMovie(movie) {
    var out = {}, fields = ['id','source','title','name','original_title','original_name','poster_path','backdrop_path','img','first_air_date','number_of_seasons','imdb_id','kinopoisk_id'];
    fields.forEach(function (k) {
      if (movie[k] === undefined) return;
      if (k === 'img' || k === 'poster_path' || k === 'backdrop_path') {
        var image=String(movie[k]);
        if (/^\/[a-zA-Z0-9/_\-.]+\.(?:jpg|jpeg|png|webp)$/i.test(image)) out[k]=image;
        else if (/^https:\/\/image\.tmdb\.org\/t\/p\/[a-zA-Z0-9/_\-.]+\.(?:jpg|jpeg|png|webp)$/i.test(image)) out[k]=image;
      } else out[k] = movie[k];
    });
    return out;
  }
  function label(value) { return typeof value === 'string' ? value : value && (value.title || value.name || value.voice_name) || ''; }
  function apiUrl(url, base) {
    if (typeof url !== 'string') return false;
    var host = /^(https?):\/\/([^/?#]+)/i.exec(base || 'https://api.lampa.stream/');
    if (!host) return false;
    if (url.charAt(0) === '/' && url.charAt(1) !== '/') url = host[1] + '://' + host[2] + url;
    var target = /^(https?):\/\/([^/?#]+)/i.exec(url);
    return !!target && target[1].toLowerCase() === host[1].toLowerCase() && target[2].toLowerCase() === host[2].toLowerCase() ? url : false;
  }
  function extractEpisodes(payload, ctx) {
    var rows = [], seen = {}, ids = {}, nodes = 0;
    if (!payload || payload.error || payload.vip || payload.similars) return rows;
    (payload.voice || []).forEach(function (v) { if (v && v.id !== undefined) ids[String(v.id)] = label(v); });
    function walk(node, season, voice, depth) {
      if (!node || typeof node !== 'object' || depth > 8 || ++nodes > 30000) return;
      if (Array.isArray(node)) { node.forEach(function (n) { walk(n, season, voice, depth + 1); }); return; }
      var n = positive(node.episode || node.episode_number);
      if (n) {
        var s = positive(node.season || node.season_number) || positive(season);
        var named = node.voice_name || (typeof node.voice === 'string' ? node.voice : '') || ids[String(node.voice_id)] || voice || ctx.confirmedVoice;
        var matched = sameVoice(ctx.voice, named);
        if (Array.isArray(node.audio_tracks)) node.audio_tracks.forEach(function (track) {
          if (sameVoice(ctx.voice, String(track.label || '').split(' / ')[0])) matched = true;
        });
        if (!s || !matched || !(node.url || node.stream || node.file)) return;
        var key = showKey(ctx.movie) + ':' + s + ':' + n;
        if (seen[key]) return;
        seen[key] = true;
        rows.push({key:key, show:showKey(ctx.movie), movie:safeMovie(ctx.movie), season:s, episode:n, voice:ctx.voice,
          title:node.title || '', sources:[{slug:ctx.source, title:String(ctx.sourceTitle || ctx.source).split('<')[0].trim()}], discoveredAt:0});
        return;
      }
      Object.keys(node).forEach(function (k) {
        if (k === 'headers' || k === 'audio_tracks' || k === 'subtitles' || k === 'quality' || k === 'qualitys') return;
        if (typeof node[k] !== 'object') return;
        var nextVoice = sameVoice(k, ctx.voice) ? k : voice;
        var knownOtherVoice = (payload.voice || []).some(function (v) { return label(v) === k && !sameVoice(k, ctx.voice); });
        if (knownOtherVoice) return;
        if (!positive(k) && !/^(folder|episode|items|results|data|HDR|SDR|4K|FHD|HD|HTTP|HLS\d*)$/i.test(k)) nextVoice = k;
        walk(node[k], positive(k) || season, nextVoice, depth + 1);
      });
    }
    walk(payload.folder || payload.episode, positive(ctx.season), ctx.confirmedVoice, 0);
    return rows.sort(function (a,b) { return a.season - b.season || a.episode - b.episode; });
  }
  function navigation(payload, ctx) {
    var out = [], seen = {};
    function add(entry, voice, season) {
      if (!entry || typeof entry !== 'object') return;
      var url = apiUrl(entry.url, ctx.api);
      if (!url || seen[url]) return;
      seen[url] = true;
      out.push({url:url, confirmedVoice:voice || ctx.confirmedVoice || '', season:season || ctx.season || 0});
    }
    (payload.voice || []).forEach(function (v) { if (sameVoice(label(v), ctx.voice)) add(v, label(v), 0); });
    (payload.season || []).forEach(function (s) {
      var number = typeof s === 'object' ? (s.number || s.season_number || parseInt(label(s).replace(/\D/g,''),10)) : parseInt(String(s).replace(/\D/g,''),10);
      add(s, ctx.confirmedVoice, positive(number));
    });
    return out;
  }
  function mergeEpisodes(groups) {
    var byKey = {}, out = [];
    groups.forEach(function (group) { (group || []).forEach(function (row) {
      var copy = byKey[row.key];
      if (!copy) { copy = Object.assign({},row,{sources:row.sources.slice()}); byKey[row.key] = copy; out.push(copy); }
      else row.sources.forEach(function (src) { if (!copy.sources.some(function (x) { return x.slug === src.slug; })) copy.sources.push(src); });
    }); });
    return out;
  }
  function buildFeed(rows, options) {
    options = options || {};
    var manual = options.manual || {}, baseline = options.baseline || {};
    return rows.map(function (row) {
      var progress = options.progress ? options.progress(row) || {} : {};
      var percent = Math.max(0, Math.min(100, Number(progress.percent) || 0));
      var mark = manual[row.key], through = baseline[row.show];
      var watched = percent >= COMPLETION_PERCENT;
      if (through && (row.season < through.season || row.season === through.season && row.episode <= through.episode)) watched = true;
      if (mark && typeof mark.watched === 'boolean') watched = mark.watched;
      return Object.assign({},row,{percent:percent, watched:watched});
    }).filter(function (row) { return !row.watched; }).sort(function (a,b) {
      return (b.discoveredAt || 0) - (a.discoveredAt || 0) || b.season - a.season || b.episode - a.episode || a.show.localeCompare(b.show);
    });
  }
  function snapshot(rows, now) {
    return {time:now, rows:rows.map(function (row) {
      return {key:row.key,show:row.show,movie:safeMovie(row.movie),season:row.season,episode:row.episode,voice:row.voice,
        title:row.title,discoveredAt:row.discoveredAt || 0,sources:row.sources.map(function (src) { return {slug:src.slug,title:String(src.title || src.slug).replace(/<[^>]*>/g,'')}; })};
    })};
  }
  return {COMPLETION_PERCENT:COMPLETION_PERCENT,positive:positive, normalizeVoice:normalizeVoice, sameVoice:sameVoice, showKey:showKey, storageKey:storageKey,
    safeMovie:safeMovie, apiUrl:apiUrl, extractEpisodes:extractEpisodes,navigation:navigation,mergeEpisodes:mergeEpisodes,buildFeed:buildFeed,snapshot:snapshot};
}));

(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./core.js'));else root.ModssEpisodesAdapter=factory(root.ModssEpisodesCore);}(typeof window!=='undefined'?window:this,function(core){
  'use strict';
  function failure(code) { var error = new Error(code); error.code = code; return error; }
  function create(Lampa, options) {
    options = options || {};
    var api = options.api || 'https://api.lampa.stream/';
    var bridges = [], cancelled = false, delay = options.delay === undefined ? 650 : options.delay;
    function bridge(movie) {
      if (cancelled) throw failure('CANCELLED');
      var C = Lampa.Component && Lampa.Component.get('modss_online');
      if (!C) throw failure('MODS_MISSING');
      var comp = new C({movie:movie, search:movie.title || movie.name || ''});
      if (typeof comp.requestParams !== 'function' || typeof comp.request !== 'function' || typeof comp.createSource !== 'function') throw failure('MODS_VERSION');
      var closed = false, pending = null, sources = {}, polling=false, pollDone=false, sourceReady=null;
      var oldLocal = comp.BalLocal;
      comp.BalLocal = function (value) {
        var actual = typeof oldLocal === 'function' ? oldLocal.call(comp, value) : value;
        sources = actual || {};
        return actual;
      };
      // These methods normally update a visible MODS activity; this instance stays detached.
      comp.updateSourcesFilter = comp.markOnlineBtn4K = comp.setSourceWaiting = comp.showChipLoading = function () {};
      var oldLife=comp.lifeSource;
      if(typeof oldLife==='function')comp.lifeSource=function(){polling=true;return oldLife.apply(comp,arguments);};
      comp.tellLiveScreen=function(done){if(closed)return;pollDone=!!done;if(pollDone&&sourceReady)sourceReady();};
      function dispose() {
        if (closed) return;
        closed = true;
        if (pending) pending(failure('CANCELLED'));
        // MODS.destroy() clears shared caches and player UI. reset() only stops this instance.
        try { if (comp.reset) comp.reset(); } catch (ignore) {}
        try { if (comp.render) comp.render().remove(); } catch (ignore2) {}
        var at = bridges.indexOf(handle); if (at !== -1) bridges.splice(at, 1);
      }
      function run(action, timeout) {
        if (closed || cancelled || options.shouldContinue && !options.shouldContinue()) return Promise.reject(failure('CANCELLED'));
        if (pending) return Promise.reject(failure('BRIDGE_BUSY'));
        return new Promise(function (resolve, reject) {
          var settled = false;
          var timer = setTimeout(function () { finish(failure('MODS_TIMEOUT')); dispose(); }, timeout || options.timeout || 25000);
          function finish(err, result) {
            if (settled) return;
            settled = true; clearTimeout(timer); pending = null;
            if (err) reject(err); else resolve(result);
          }
          pending = function (err) { finish(err); };
          comp.parse = function (json) {
            if(options.shouldContinue && !options.shouldContinue())return finish(failure('CANCELLED'));
            if (!json || typeof json !== 'object') return finish(failure('MODS_RESPONSE'));
            if (json.error || json.vip || json.sig === 'expired') return finish(failure('MODS_DENIED'));
            finish(null,json);
          };
          comp.doesNotAnswer = function () { finish(failure('MODS_REQUEST')); };
          comp.empty = function () { finish(failure('MODS_RATE_LIMIT')); };
          try { action(finish); } catch (error) { finish(failure('MODS_VERSION')); }
        });
      }
      var handle = {
        dispose:dispose,
        request:function (url) {
          var safe = core.apiUrl(url, api);
          if (!safe) return Promise.reject(failure('UNSAFE_URL'));
          return run(function () { comp.request(comp.requestParams(safe)); });
        },
        sources:function () {
          return run(function (finish) {
            var returned=false;
            sourceReady=function(){
              if(!returned||polling&&!pollDone)return;
              if(options.shouldContinue&&!options.shouldContinue())return finish(failure('CANCELLED'));
              finish(null,sources);sourceReady=null;
            };
            comp.createSource().then(function () {returned=true;sourceReady();}, function (json) {finish(failure(json && json.vip ? 'MODS_DENIED' : 'MODS_REQUEST'));});
          },options.sourceTimeout || options.timeout || 45000);
        }
      };
      bridges.push(handle);
      return handle;
    }
    function pause() { return new Promise(function (resolve) { setTimeout(resolve,delay); }); }
    function request(movie,url) {
      if (!core.apiUrl(url,api)) return Promise.reject(failure('UNSAFE_URL'));
      var b;
      try { b = bridge(movie); } catch (e) { return Promise.reject(e); }
      return b.request(url).then(function (json) { b.dispose(); return json; },function (e) { b.dispose(); throw e; });
    }
    function subscriptions() {
      return request({id:0,name:'',original_title:'',source:'tmdb'},api+'subscr/mysubscr').then(function (json) {
        if (!json.success || !Array.isArray(json.subscriptions)) throw failure('MODS_RESPONSE');
        return json.subscriptions.filter(function (s) { return s.active !== false && s.active !== 0 && s.active !== '0' && s.voice; }).map(function (s) {
          var card = s.card || {};
          if (typeof card === 'string') { try { card = JSON.parse(card); } catch (ignore) { card = {}; } }
          card = core.safeMovie(card);
          card.id = card.id || s.movie_id; card.source = card.source || s.source || 'tmdb';
          card.name = card.name || s.title; card.title = card.title || s.title;
          return {movie:card,voice:s.voice};
        }).filter(function (sub) { return sub.movie.id; });
      });
    }
    function scan(sub, previous) {
      previous = previous || [];
      var b;
      try { b = bridge(sub.movie); } catch (e) { return Promise.reject(e); }
      var groups = [], errors = [], attempted = {}, totalRequests = 0;
      function source(slug, info) {
        attempted[slug] = true;
        var collected = [], visited = {}, queue = [{url:info.url}], parsed = false;
        function next() {
          if (cancelled) return Promise.reject(failure('CANCELLED'));
          var task = queue.shift();
          if (!task) { if (!parsed) throw failure('MODS_FORMAT'); groups.push(collected); return Promise.resolve(); }
          if (visited[task.url]) return next();
          if (++totalRequests > 80 || Object.keys(visited).length >= 24) return Promise.reject(failure('MODS_LIMIT'));
          visited[task.url] = true;
          return pause().then(function () { return b.request(task.url); }).then(function (json) {
            var ctx = {movie:sub.movie,voice:sub.voice,source:slug,sourceTitle:info.name || slug,confirmedVoice:task.confirmedVoice,season:task.season,api:api};
            if (json.folder || json.episode || json.voice || json.season) parsed = true;
            collected = collected.concat(core.extractEpisodes(json,ctx));
            queue = queue.concat(core.navigation(json,ctx));
            return next();
          });
        }
        return next().catch(function (e) {
          if (e.code === 'CANCELLED') throw e;
          errors.push({source:slug,code:e.code || 'MODS_REQUEST'});
          groups.push(collected);
          groups.push(previous.filter(function (row) { return row.sources.some(function (src) { return src.slug === slug; }); }).map(function(row){
            return Object.assign({},row,{sources:row.sources.filter(function(src){return src.slug===slug;})});
          }));
        });
      }
      return b.sources().then(function (sources) {
        var chain = Promise.resolve();
        Object.keys(sources).forEach(function (slug) {
          var info = sources[slug];
          if (!info || info.disabled || info.show === false || !core.apiUrl(info.url,api)) return;
          chain = chain.then(function () { return source(slug,info); });
        });
        return chain;
      }).then(function () {
        b.dispose();
        if (!Object.keys(attempted).length){errors.push({source:'',code:'MODS_NO_SOURCES'});groups.push(previous);}
        return {rows:core.mergeEpisodes(groups),partial:errors.length>0,errors:errors};
      }, function (e) { b.dispose(); throw e; });
    }
    function abort() { cancelled = true; bridges.slice().forEach(function (b) { b.dispose(); }); }
    return {subscriptions:subscriptions,scan:scan,request:request,abort:abort};
  }
  return {create:create};
}));

(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./core.js'),require('./adapter.js'));else root.ModssNewEpisodes=factory(root.ModssEpisodesCore,root.ModssEpisodesAdapter).install(root);}(typeof window!=='undefined'?window:this,function(core,adapter){
  'use strict';
  var VERSION='0.1.4', TITLE='Новые серии · MODS’s', TTL=10*60*1000;
  function subscriptionStatus(subscriptions,movie,voice){
    var subscribed=!!voice&&(subscriptions||[]).some(function(s){return s.active!==false&&s.active!==0&&core.showKey(s.movie)===core.showKey(movie)&&core.sameVoice(s.voice,voice);});
    return {subscribed:subscribed,label:voice?(subscribed?'Уже подписан на ':'Подписаться на ')+voice:'Подписаться на озвучку'};
  }
  function subscriptionChoice(items,voice){
    var found=null;(items||[]).some(function(item){
      if(!item.unsubscribe_action&&item.voice_data&&core.sameVoice(item.voice_data.voice_name,voice)){found=item;return true;}return false;
    });return found;
  }
  function mountSubscribeButton(Lampa,$,movie,invalidate){
    if(!movie||movie.type==='movie'||movie.media_type==='movie'||!(movie.name||movie.original_name||movie.first_air_date||movie.number_of_seasons>0))return false;
    var a=Lampa.Activity.active();if(!a||a.component!=='full'||!a.activity)return false;
    if(a.card&&a.card.id&&movie.id&&String(a.card.id)!==String(movie.id))return false;
    var area=a.activity.render(),online=area.find('.view--modss_online').first?area.find('.view--modss_online').first():area.find('.view--modss_online');
    if(area.find('.mnef-subscribe').length||!online.length)return false;
    var button=$('<div class="full-start__button selector mnef-subscribe"><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg><span>Подписаться на обновления</span></div>');
    button.on('hover:enter',function(){
      if(online.hasClass('modss-online--loading'))return Lampa.Noty.show('Подожди, MODS’s ещё проверяет источники');
      invalidate();online.trigger('hover:long');
    });online.after(button);return true;
  }
  function insertRow(data,row) {
    var out=(data||[]).filter(function(x){return !x.mnef;}), at=-1;
    out.some(function(x,i){if(/сейчас смотрят|now watching/i.test(x.title||'')){at=i;return true;}return false;});
    out.splice(at>=0?at+1:Math.min(1,out.length),0,row);return out;
  }
  function mayRefresh(active,playing,visibility){return !!active&&active.component==='main'&&!playing&&visibility!=='hidden';}
  function currentScan(scope,profile,expected,actual,alive){return !!alive&&scope===profile&&expected===actual;}
  function pages(rows,size){var out=[];for(var i=0;i<rows.length;i+=size)out.push(rows.slice(i,i+size));return out;}
  function targetChoice(payload,target){
    var order=(payload.season||[]).map(function(s){var value=typeof s==='object'?(s.number||s.season_number||s.name||s.title):s;return Number(String(value).replace(/\D/g,''));}).filter(function(n){return n>0;}).sort(function(a,b){return a-b;});
    var out={voice_name:target.voice,voice_id:0,order:1},index=order.indexOf(Number(target.season));if(index>=0)out.season=index;return out;
  }
  function timelineFor(Lampa,row,title){
    var parts=[row.season,row.season>10?':':'',row.episode,title];
    var hash=Lampa.Utils.hash(parts.join(''));
    var link=Lampa.Timeline.link?Lampa.Timeline.link(row.movie,row.season,row.episode):null;
    return Lampa.Timeline.view(hash,link);
  }
  function progressFor(Lampa,row){
    var movie=row.movie||{}, names=[movie.original_title||movie.original_name||movie.name||movie.title||''];
    if(movie.original_name&&names.indexOf(movie.original_name)===-1)names.push(movie.original_name);
    var found=names.map(function(name){return timelineFor(Lampa,row,name);});
    // Modern timelines carry timestamps; legacy ones must prefer the canonical MODS title,
    // not a completed alias left behind by an earlier manual mark or another source.
    var newest=found[0];found.forEach(function(view){if((Number(view.updated)||0)>(Number(newest.updated)||0))newest=view;});
    if(newest&&Number(newest.updated)>0)return newest;
    found=found.filter(function(view){return Number(view.percent)||Number(view.time)||Number(view.duration);});
    return found[0]||{percent:0};
  }
  function markEpisode(Lampa,row,watched){
    var old=progressFor(Lampa,row), movie=row.movie||{};
    var names=[movie.original_title||movie.original_name||movie.name||movie.title||''];
    if(movie.original_name&&names.indexOf(movie.original_name)===-1)names.push(movie.original_name);
    names.forEach(function(name){
      var view=timelineFor(Lampa,row,name), link=Lampa.Timeline.link?Lampa.Timeline.link(movie,row.season,row.episode):{};
      var value={hash:view.hash,percent:watched?100:0,time:watched?Number(old.time)||0:0,duration:Number(old.duration)||0,profile:view.profile||0};
      Object.keys(link||{}).forEach(function(k){value[k]=link[k];});
      Lampa.Timeline.update(value);
    });
  }
  function episodeCard(row){
    var card=core.safeMovie(row.movie);card.name=card.name||card.title;card.title=card.name;card.mnef=row;
    card.vote_average=0;card.params={};card.mnefCaption=row.voice+' · '+row.sources.map(function(s){return s.title||s.slug;}).join(', ');if(card.backdrop_path)card.poster_path=card.backdrop_path;
    return card;
  }
  function statusCard(text){return {id:0,title:text,name:text,mnefStatus:true,params:{}};}
  function install(root){
    if(root.ModssNewEpisodes&&root.ModssNewEpisodes.dispose)root.ModssNewEpisodes.dispose();
    var Lampa=root.Lampa,$=root.jQuery||root.$,homes=[],targets=[],service=null,busy=null,alive=true,timer=null,bootTimer=null,scheduled=null,timelineTimer=null,buttonTimer=null;
    var originalMain=null,wrappedMain=null,profile='',state={rows:[],time:0,partial:false,errors:[],subscriptions:[]},status='Проверяю подписки…';
    var episodeButtonTimer=null,pendingSubscription=null,latestFullKey='',nativeSubscriptionButton=null;
    var subscriptionStatusService=null,subscriptionStatusTime=0;
    function profileName(){
      var account=Lampa.Storage.get('account',{}), lp=Lampa.Storage.get('lampac_profile_id','');
      var email=Lampa.Storage.get('account_email','');var id=lp||account&&account.profile&&account.profile.id||'guest';
      return String(Lampa.Utils.hash(email||'guest'))+'_'+String(id);
    }
    function loadProfile(){
      var next=profileName();if(next===profile)return false;
      if(service)service.abort();service=null;busy=null;profile=next;pendingSubscription=null;nativeSubscriptionButton=null;latestFullKey='';
      if(subscriptionStatusService)subscriptionStatusService.abort();subscriptionStatusService=null;subscriptionStatusTime=0;
      state=Lampa.Storage.get(core.storageKey('cache',profile),{rows:[],time:0,partial:false,errors:[],subscriptions:[]});
      if(!state||!Array.isArray(state.rows))state={rows:[],time:0,partial:false,errors:[],subscriptions:[]};
      status=state.time?'':'Проверяю подписки…';return true;
    }
    function active(){return Lampa.Activity.active();}
    function allowed(){return mayRefresh(active(),Lampa.Player&&Lampa.Player.opened&&Lampa.Player.opened(),root.document.visibilityState);}
    function feed(){return core.buildFeed(state.rows,{progress:function(row){return progressFor(Lampa,row);}});}
    function rowData(){
      var rows=feed(), suffix=busy?' · обновляю…':state.partial?' · часть источников недоступна':state.time&&Date.now()-state.time>TTL?' · сохранённые данные':'';
      var message=status||(state.rows.length?'Всё доступное уже просмотрено':'Доступных новых серий пока нет');
      return {mnef:true,title:TITLE+suffix,results:rows.length?rows.slice(0,200).map(episodeCard):[statusCard(message)],params:{items:{mapping:'line',view:7}}};
    }
    function note(text){Lampa.Noty.show(text);}
    function select(title,items){Lampa.Select.show({title:title,items:items,onBack:function(){Lampa.Controller.toggle('content');},onSelect:function(item){Lampa.Select.hide();if(item.action)item.action();}});}
    function refreshMenu(){
      var watched=state.rows.filter(function(row){return Number(progressFor(Lampa,row).percent)>=core.COMPLETION_PERCENT;}).sort(function(a,b){return b.season-a.season||b.episode-a.episode;});
      select(TITLE,[
        {title:'Обновить доступные серии',action:function(){refresh(true);}},
        {title:'Просмотренные серии · '+watched.length,action:function(){
          if(!watched.length)return note('Просмотренных серий в текущем списке нет');
          var groups=pages(watched,50);
          function showPage(index){var items=groups[index].map(function(row){return {title:(row.movie.name||row.movie.title)+' · S'+row.season+':E'+row.episode,subtitle:row.voice,action:function(){markEpisode(Lampa,row,false);updateHomes();}};});
            if(index>0)items.unshift({title:'← Предыдущая страница',action:function(){showPage(index-1);}});
            if(index<groups.length-1)items.push({title:'Следующая страница →',action:function(){showPage(index+1);}});
            select('Вернуть в непросмотренные · '+(index+1)+'/'+groups.length,items);
          }showPage(0);
        }},
        {title:'Управлять подписками MODS’s',action:function(){Lampa.Activity.push({component:'subscribes',title:'Подписки',source:Lampa.Storage.field('source')||'tmdb'});}},
        {title:'О ленте',action:function(){note('Серии берутся из MODS’s в выбранной озвучке. Просмотрено: от 85%. История общая со штатной Lampa; для Lampac подключи Sync и TimeCode на обоих устройствах.');}}
      ]);
    }
    function openEpisode(row){
      var last=Lampa.Storage.get('online_last_balanser',{}),source=row.sources[0]&&row.sources[0].slug;
      if(!source)return note('Сначала обнови доступные источники');
      if(last[row.movie.id]&&row.sources.some(function(x){return x.slug===last[row.movie.id];}))source=last[row.movie.id];
      var choices=Lampa.Storage.get('online_choice_'+source,{}),choice=choices[row.movie.id]||{};
      choice.voice_name=row.voice;choice.voice_id=0;choice.voice=0;choice.order=1;
      choices[row.movie.id]=choice;last[row.movie.id]=source;
      Lampa.Storage.set('online_choice_'+source,choices);Lampa.Storage.set('online_last_balanser',last);
      Lampa.Activity.push({component:'modss_online',movie:row.movie,search:row.movie.name||row.movie.title,title:row.movie.name||row.movie.title,mnef_target:{season:row.season,episode:row.episode,voice:row.voice}});
    }
    function attachTarget(comp,target){
      if(!comp||comp._mnefTarget||!target)return;
      var record={comp:comp,parse:comp.parse,draw:comp.draw,destroy:comp.destroy,timer:null,focused:false,attempts:0};comp._mnefTarget=true;targets.push(record);
      function clean(){clearTimeout(record.timer);comp.parse=record.parse;comp.draw=record.draw;comp.destroy=record.destroy;comp._mnefTarget=false;var at=targets.indexOf(record);if(at>=0)targets.splice(at,1);}
      record.clean=clean;
      function focus(){
        if(!alive||record.focused)return;
        var a=active();if(!a||a.component!=='modss_online'||!a.activity||a.activity.component!==comp)return;
        var cards=comp.episodeCards&&comp.episodeCards(),match=null,want='S'+target.season+':E'+target.episode;
        if(cards)cards.each(function(){if($(this).data('modss_se')===want)match=this;});
        if(match){
          record.focused=true;Lampa.Controller.enable('content');
          Lampa.Controller.collectionSet(comp.episodesScroll().render(),comp.render());
          if(root.Navigator&&root.Navigator.focus)root.Navigator.focus(match);else Lampa.Controller.collectionFocus(match,comp.render());
          if(comp.scrollTo)comp.scrollTo($(match),true);return;
        }
        if(++record.attempts<40){if(comp.loadMoreItems)comp.loadMoreItems();record.timer=setTimeout(focus,150);}
      }
      // MODS settles its initial focus after 400 ms; focus the requested card afterwards.
      function scheduleFocus(){clearTimeout(record.timer);record.timer=setTimeout(focus,650);}
      comp.parse=function(json){if(comp.replaceChoice&&json&&json.season)comp.replaceChoice(targetChoice(json,target));var value=record.parse.apply(comp,arguments);scheduleFocus();return value;};
      if(typeof record.draw==='function')comp.draw=function(){var value=record.draw.apply(comp,arguments);scheduleFocus();return value;};
      comp.destroy=function(){clean();return record.destroy.apply(comp,arguments);};
    }
    function episodeMenu(row){
      select((row.movie.name||row.movie.title)+' · S'+row.season+':E'+row.episode,[
        {title:'Открыть в MODS’s · '+row.voice,action:function(){openEpisode(row);}},
        {title:'Отметить просмотренной',action:function(){markEpisode(Lampa,row,true);updateHomes();}},
        {title:'Просмотрено до этой серии включительно',action:function(){
          var rows=state.rows.filter(function(x){return x.show===row.show&&(x.season<row.season||x.season===row.season&&x.episode<=row.episode);});
          select('Отметить '+rows.length+' доступных серий?',[
            {title:'Отметить просмотренными',action:function(){rows.forEach(function(x){markEpisode(Lampa,x,true);});updateHomes();}},
            {title:'Отмена'}
          ]);
        }},
        {title:'Обновить ленту',action:function(){refresh(true);}}
      ]);
    }
    function wireLine(line,comp){
      line.use({
        onMore:refreshMenu,
        onCreate:function(){this.render().addClass('mnef-line');},
        onInstance:function(card,data){
          card.use({
            onEnter:function(){if(data.mnef)openEpisode(data.mnef);else refreshMenu();},
            onFocus:function(){if(data.mnef&&Lampa.Background)Lampa.Background.change(Lampa.Utils.cardImgBackground(data.mnef.movie));},
            onCreate:function(){
              var el=this.render();el.addClass('mnef-card');
              if(data.mnef){
                var row=data.mnef,stamp='S'+row.season+':E'+row.episode;
                el.attr('data-mnef-key',row.key);
                el.find('.card__name').text((row.movie.name||row.movie.title)+' · '+stamp);
                el.find('.card__year').text(row.voice+' · '+row.sources.map(function(s){return s.title||s.slug;}).join(', '));
                $('<div class="mnef-caption"></div>').text(data.mnefCaption).appendTo(el);
                $('<span class="mnef-badge"></span>').text(stamp).appendTo(el.find('.card__view'));
                if(row.percent>0)$('<div class="mnef-progress"><i></i></div>').find('i').css('width',row.percent+'%').end().appendTo(el.find('.card__view'));
              }else{
                el.addClass('mnef-status');el.find('.card__year').text('Открой меню ленты');
                $('<span class="mnef-status-label"></span>').text(data.title).appendTo(el.find('.card__view'));
              }
              el.off('hover:long').on('hover:long.mnef contextmenu.mnef',function(e){e.preventDefault();e.stopImmediatePropagation();if(data.mnef)episodeMenu(data.mnef);else refreshMenu();});
            }
          });
        }
      });
      if(comp)line.use({
        onDown:comp.emit.bind(comp,'down'),onUp:comp.emit.bind(comp,'up'),onLeft:comp.emit.bind(comp,'left'),onBack:comp.emit.bind(comp,'back'),
        onActive:function(){comp.active=comp.items.indexOf(line);},onToggle:function(){comp.scroll.update(line.render(true));}
      });
    }
    function replaceLine(home){
      var comp=home.comp;if(home.dead||!comp.items||!comp.items.length||!Lampa.Maker)return;
      var old=home.line,at=old?comp.items.indexOf(old):-1,focused=old&&Lampa.Controller.own&&Lampa.Controller.own(old);
      var line=Lampa.Maker.make('Line',rowData(),function(mask){return mask.MASK.base;});
      wireLine(line,comp);line.create();
      var node=line.render(true);
      if(at>=0){
        var oldNode=old.render(true);if(oldNode.parentNode)oldNode.parentNode.replaceChild(node,oldNode);
        comp.items[at]=line;old.destroy();
      }else{
        var watching=-1;comp.items.some(function(item,i){if(/сейчас смотрят|now watching/i.test(item.data&&item.data.title||'')){watching=i;return true;}return false;});
        at=watching>=0?watching+1:Math.min(1,comp.items.length);
        var anchor=comp.items[at-1],anchorNode=anchor&&anchor.render(true);
        if(!anchorNode||!anchorNode.parentNode){line.destroy();return;}
        anchorNode.parentNode.insertBefore(node,anchorNode.nextSibling);comp.items.splice(at,0,line);
        if(comp.active>=at)comp.active++;
      }
      home.line=line;Lampa.Layer.visible(comp.scroll.render(true));if(focused)line.toggle();
    }
    function updateHomes(){if(!alive)return;homes.slice().forEach(replaceLine);}
    function attach(comp){
      if(!comp||comp._mnefAttached)return;comp._mnefAttached=true;
      var home={comp:comp,line:null,dead:false,build:comp.build,emit:comp.emit};homes.push(home);
      comp.build=function(data){return home.build.call(comp,insertRow(data,rowData()));};
      comp.emit=function(event,a,b){
        if(event==='instance'&&b&&b.mnef){home.line=a;wireLine(a,null);return;}
        return home.emit.apply(comp,arguments);
      };
      home.module={onStart:schedule,onDestroy:function(){home.dead=true;var at=homes.indexOf(home);if(at>=0)homes.splice(at,1);}};
      comp.use(home.module);
      if(comp.items&&comp.items.length)replaceLine(home);
    }
    function schedule(){clearTimeout(scheduled);scheduled=setTimeout(function(){refresh(false);},1500);}
    function refresh(force){
      if(!alive||!Lampa)return Promise.resolve();
      loadProfile();
      if(busy)return busy;
      if(!allowed())return Promise.resolve();
      if(!force&&state.time&&Date.now()-state.time<TTL){updateHomes();return Promise.resolve();}
      var scope=profile,old=state,all=[],errors=[],subs=[];
      var currentService=adapter.create(Lampa,{shouldContinue:function(){return currentScan(scope,profile,currentService,service,alive)&&allowed();}});service=currentService;
      status='Проверяю подписки…';
      busy=currentService.subscriptions().then(function(items){
        if(!currentScan(scope,profile,currentService,service,alive))throw {code:'CANCELLED'};
        subs=items;
        if(!items.length)status='Подпишись на озвучку сериала в MODS’s';else status='Проверяю доступные серии…';
        var chain=Promise.resolve();
        items.forEach(function(sub){chain=chain.then(function(){
          if(!currentScan(scope,profile,currentService,service,alive)||!allowed()){currentService.abort();throw {code:'CANCELLED'};}
          var previous=old.rows.filter(function(row){return row.show===core.showKey(sub.movie)&&core.sameVoice(row.voice,sub.voice);});
          return currentService.scan(sub,previous).then(function(result){all=all.concat(result.rows);errors=errors.concat(result.errors);},function(e){
            if(e.code==='CANCELLED')throw e;all=all.concat(previous);errors.push({source:'',code:e.code||'MODS_REQUEST'});
          });
        });});return chain;
      }).then(function(){
        if(!currentScan(scope,profile,currentService,service,alive)||!allowed())return;
        var previousByKey={};old.rows.forEach(function(row){previousByKey[row.key]=row;});
        all=core.mergeEpisodes([all]);all.forEach(function(row){row.discoveredAt=previousByKey[row.key]?previousByKey[row.key].discoveredAt||0:old.time?Date.now():0;});
        state=core.snapshot(all,Date.now());state.partial=errors.length>0;state.errors=errors;state.subscriptions=subs;
        Lampa.Storage.set(core.storageKey('cache',profile),state);status=subs.length?'':'Подпишись на озвучку сериала в MODS’s';
      }).catch(function(e){
        if(!currentScan(scope,profile,currentService,service,alive)||e.code==='CANCELLED')return;
        state=old;state.partial=true;
        status=state.rows.length?'':'Не удалось проверить MODS’s. Открой онлайн-просмотр и обнови ленту.';
      }).then(function(){
        if(currentScan(scope,profile,currentService,service,alive)){busy=null;service=null;updateHomes();}
      });
      updateHomes();return busy;
    }
    function activityEvent(e){
      if(!alive)return;
      if(e.component==='modss_online'&&(e.type==='start'||e.type==='create'))queueEpisodeButton();
      if(e.component==='full'&&(e.type==='start'||e.type==='create'))queueSubscriptionButton(e.object&&e.object.card);
      if(e.component==='main'&&(e.type==='create'||e.type==='start')){
        loadProfile();var comp=e.object&&e.object.activity&&e.object.activity.component;attach(comp);schedule();
      }else if(e.component==='modss_online'&&(e.type==='create'||e.type==='start')){
        if(service)service.abort();var params=e.object||active();attachTarget(params&&params.activity&&params.activity.component,params&&params.mnef_target);
      }else if(e.type==='start'&&e.component!=='main'&&service)service.abort();
    }
    function queueEpisodeButton(){
      clearTimeout(episodeButtonTimer);subscriptionStatusTime=0;
      function check(){
        if(!alive)return;var a=active();if(!a||a.component!=='modss_online')return;
        var movie=a.movie,c=a.activity&&a.activity.component;
        if(c&&movie&&movie.name){
          if(!subscriptionStatusService&&Date.now()-subscriptionStatusTime>60000&&root.document.visibilityState!=='hidden'&&!(Lampa.Player&&Lampa.Player.opened&&Lampa.Player.opened()))refreshSubscriptionStatus();
          var area=c.render(),head=area.find('.torrent-filter').first(),button=area.find('.mnef-episode-subscribe');
          if(head.length&&!button.length){
            button=$('<div class="simple-button selector mnef-episode-subscribe"><span></span></div>');
            button.on('hover:enter',function(){
              var choice=c.getChoice(),voice=choice.voice_name||'';
              if(subscriptionStatus(state.subscriptions,movie,voice).subscribed)return note('Подписка на '+voice+' уже есть');
              pendingSubscription={movie:movie,voice:voice,time:Date.now()};
              state.time=0;Lampa.Storage.set(core.storageKey('cache',profile),state);
              if(latestFullKey===core.showKey(movie)&&nativeSubscriptionButton&&nativeSubscriptionButton.length&&!nativeSubscriptionButton.hasClass('modss-online--loading'))nativeSubscriptionButton.trigger('hover:long');
              else Lampa.Router.call('full',movie);
            });head.append(button);
          }
          if(button.length){var voice=c.getChoice().voice_name||'';button.find('span').text(subscriptionStatus(state.subscriptions,movie,voice).label);}
        }
        episodeButtonTimer=setTimeout(check,700);
      }episodeButtonTimer=setTimeout(check,200);
    }
    function refreshSubscriptionStatus(){
      subscriptionStatusTime=Date.now();var scope=profile,s=adapter.create(Lampa);subscriptionStatusService=s;
      s.subscriptions().then(function(items){
        if(alive&&scope===profile&&subscriptionStatusService===s){state.subscriptions=items;Lampa.Storage.set(core.storageKey('cache',profile),state);}
      }).catch(function(){}).then(function(){if(subscriptionStatusService===s)subscriptionStatusService=null;});
    }
    function subscriptionPicker(e){
      var pending=pendingSubscription;if(!pending||Date.now()-pending.time>15000){pendingSubscription=null;return;}
      if(latestFullKey!==core.showKey(pending.movie)){pendingSubscription=null;return;}
      var picker=e.active;if(!picker||!picker.items||!picker.items.some(function(i){return i.voice_data||i.is_folder;}))return;
      pendingSubscription=null;
      if(!pending.voice)return;
      var choice=subscriptionChoice(picker.items,pending.voice);
      if(choice&&typeof picker.onSelect==='function'){
        if(choice.isSubscribed)return note('Подписка на '+pending.voice+' уже есть');
        picker.onSelect(choice);
      }
    }
    function queueSubscriptionButton(movie){
      clearTimeout(buttonTimer);var tries=0;
      function attempt(){
        if(!alive)return;var a=active();if(!a||a.component!=='full')return;
        var card=movie||a.card;if(!card)return;
        var original=a.activity.render().find('.view--modss_online').first();
        if(original.length){latestFullKey=core.showKey(card);nativeSubscriptionButton=original;}
        var added=mountSubscribeButton(Lampa,$,card,function(){state.time=0;Lampa.Storage.set(core.storageKey('cache',profile),state);});
        if(pendingSubscription&&core.showKey(pendingSubscription.movie)===core.showKey(card)&&original.length){
          if(original.hasClass('modss-online--loading')){if(++tries<60)buttonTimer=setTimeout(attempt,250);return;}
          original.trigger('hover:long');return;
        }
        if(!added&&++tries<20)buttonTimer=setTimeout(attempt,250);
      }buttonTimer=setTimeout(attempt,150);
    }
    function fullEvent(e){if(e.type==='complite'&&e.data)queueSubscriptionButton(e.data.movie);}
    function visibilityEvent(){if(root.document.visibilityState==='hidden'){if(service)service.abort();}else schedule();}
    function timelineEvent(){clearTimeout(timelineTimer);timelineTimer=setTimeout(function(){if(alive)updateHomes();},120);}
    function storageEvent(e){if(e.name==='account'||e.name==='lampac_profile_id'||e.name==='account_email'){loadProfile();updateHomes();schedule();}}
    function boot(){
      if(!alive)return;
      Lampa=root.Lampa;$=root.jQuery||root.$;
      if(!Lampa||!$||!Lampa.Component||!Lampa.Component.get('modss_online')){bootTimer=setTimeout(boot,1000);return;}
      originalMain=Lampa.Component.get('main');
      wrappedMain=function(object){var comp=new originalMain(object);attach(comp);return comp;};
      Lampa.Component.add('main',wrappedMain);loadProfile();
      var css='.mnef-line .card{width:19em}.mnef-line .card__view{padding-bottom:56.25%;position:relative}.mnef-line .card__img{object-fit:cover}.mnef-line .card__year{display:none}.mnef-caption{font-size:.85em;opacity:.8;line-height:1.4;margin-top:.4em;max-width:24em}.mnef-badge{position:absolute;left:.5em;top:.5em;padding:.25em .45em;background:rgba(0,0,0,.8);color:white;border-radius:.25em;font-size:1.1em;font-weight:700;z-index:3}.mnef-progress{position:absolute;bottom:.4em;left:3%;width:94%;height:.25em;background:rgba(255,255,255,.25);z-index:3}.mnef-progress i{display:block;height:100%;background:#fff}.mnef-status .card__view{background:linear-gradient(135deg,#263c51,#18202c)}.mnef-status img{display:none}.mnef-status-label{position:absolute;left:12%;right:12%;top:12%;bottom:12%;display:flex;align-items:center;justify-content:center;text-align:center;font-size:1.1em;line-height:1.4}.mnef-line .card__name{white-space:normal;line-height:1.3}';
      $('<style id="mnef-style"></style>').text(css).appendTo('head');
      Lampa.Listener.follow('activity',activityEvent);
      Lampa.Listener.follow('full',fullEvent);
      if(Lampa.Select&&Lampa.Select.listener)Lampa.Select.listener.follow('fullshow',subscriptionPicker);
      if(Lampa.Timeline.listener)Lampa.Timeline.listener.follow('update',timelineEvent);
      if(Lampa.Timeline.listener)Lampa.Timeline.listener.follow('read',timelineEvent);
      Lampa.Storage.listener.follow('change',storageEvent);
      root.document.addEventListener('visibilitychange',visibilityEvent);
      var current=active();if(current&&current.component==='main')attach(current.activity&&current.activity.component);else if(current&&current.component==='full')queueSubscriptionButton(current.card);else if(current&&current.component==='modss_online')queueEpisodeButton();
      timer=setInterval(function(){if(allowed())refresh(false);},60000);schedule();
    }
    function dispose(){
      alive=false;if(service)service.abort();clearTimeout(bootTimer);clearTimeout(scheduled);clearTimeout(timelineTimer);clearTimeout(buttonTimer);clearInterval(timer);
      clearTimeout(episodeButtonTimer);pendingSubscription=null;nativeSubscriptionButton=null;
      if(subscriptionStatusService)subscriptionStatusService.abort();subscriptionStatusService=null;
      if(!Lampa)return;
      if(wrappedMain&&Lampa.Component.get('main')===wrappedMain)Lampa.Component.add('main',originalMain);
      if(Lampa.Listener&&Lampa.Listener.remove)Lampa.Listener.remove('activity',activityEvent);
      if(Lampa.Listener&&Lampa.Listener.remove)Lampa.Listener.remove('full',fullEvent);
      if(Lampa.Select&&Lampa.Select.listener)Lampa.Select.listener.remove('fullshow',subscriptionPicker);
      if(Lampa.Timeline.listener){Lampa.Timeline.listener.remove('update',timelineEvent);Lampa.Timeline.listener.remove('read',timelineEvent);}
      if(Lampa.Storage.listener)Lampa.Storage.listener.remove('change',storageEvent);
      root.document.removeEventListener('visibilitychange',visibilityEvent);targets.slice().forEach(function(record){record.clean();});
      homes.forEach(function(home){
        var comp=home.comp;comp.build=home.build;comp.emit=home.emit;comp._mnefAttached=false;if(comp.unuse)comp.unuse(home.module);
        if(home.line){var at=comp.items.indexOf(home.line);if(at>=0)comp.items.splice(at,1);home.line.destroy();}
      });homes=[];if($){$('#mnef-style').remove();$('.mnef-subscribe,.mnef-episode-subscribe').remove();}
    }
    var handle={version:VERSION,refresh:function(){return refresh(true);},menu:refreshMenu,dispose:dispose,
      summary:function(){return {version:VERSION,busy:!!busy,rows:state.rows.length,unwatched:feed().length,partial:state.partial,subscriptions:state.subscriptions.length};}};
    boot();return handle;
  }
  return {subscriptionStatus:subscriptionStatus,subscriptionChoice:subscriptionChoice,mountSubscribeButton:mountSubscribeButton,insertRow:insertRow,mayRefresh:mayRefresh,currentScan:currentScan,pages:pages,targetChoice:targetChoice,progressFor:progressFor,markEpisode:markEpisode,episodeCard:episodeCard,statusCard:statusCard,install:install};
}));
