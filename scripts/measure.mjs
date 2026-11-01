const BASE="http://127.0.0.1:5099/api";
async function j(m,p,b){const r=await fetch(BASE+p,{method:m,headers:b===undefined?{}:{"content-type":"application/json"},body:b===undefined?undefined:JSON.stringify(b)});const t=await r.text();let d;try{d=JSON.parse(t)}catch{d=t}if(!r.ok)throw new Error(`${m} ${p} ${r.status} ${JSON.stringify(d).slice(0,150)}`);return d;}
const src = await j("GET","/projects/proj_VpCznblVLp");
const raw = src.segments.map(s=>s.text).join("").replace(/\s+/g,"");
console.log("脚本字数:", raw.length);
const p = await j("POST","/projects",{ sourceType:"idea", topic:"康波周期 · 成本实测", raw, requirements:{ brief:"口播稿：保留原文", targetDurationSec:180, language:"zh", bgmMode:"generate" } });
console.log("created:", p.id);
await j("POST",`/projects/${p.id}/start`,{});
const t0=Date.now();
for(;;){await new Promise(r=>setTimeout(r,10000));const q=await j("GET",`/projects/${p.id}`);
if(q.status!=="running"){console.log("状态:",q.status,"| 时长:",q.assets?.videoDuration,"| 大小:",q.assets?.videoSize,"| 项目:",p.id);break;}
if(Date.now()-t0>20*60*1000){console.log("timeout");break;}}
