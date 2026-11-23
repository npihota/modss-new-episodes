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
