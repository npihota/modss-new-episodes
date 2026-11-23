(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ModssEpisodesCore = factory();
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
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
      var watched = percent >= 90;
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
  return {positive:positive, normalizeVoice:normalizeVoice, sameVoice:sameVoice, showKey:showKey, storageKey:storageKey,
    safeMovie:safeMovie, apiUrl:apiUrl, extractEpisodes:extractEpisodes,navigation:navigation,mergeEpisodes:mergeEpisodes,buildFeed:buildFeed,snapshot:snapshot};
}));
