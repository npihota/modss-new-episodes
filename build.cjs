const fs=require('node:fs');const path=require('node:path');
const sources=['core.js','adapter.js','plugin.js'];
const banner='/* MODS New Episodes v0.1.0 | Independent Lampa add-on | No embedded account data */\n';
const bundle=banner+sources.map(name=>fs.readFileSync(path.join(__dirname,'src',name),'utf8')).join('\n');
const output=process.argv[2]?path.resolve(process.argv[2]):path.join(__dirname,'dist','modss-new-episodes.js');
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,bundle,'utf8');
console.log('Built modss-new-episodes.js ('+Buffer.byteLength(bundle)+' bytes)');
