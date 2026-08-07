import http from 'http';
const agent = new http.Agent({ keepAlive:true, maxSockets:64 });
function hit(path){ return new Promise(r=>{ const q=http.request({port:5398,path,agent},res=>{res.resume();res.on('end',()=>r(res.statusCode));}); q.on('error',()=>r(0)); q.end(); }); }
async function measure(cheapConc, loginRate, dur, label, loginPath='/login') {
  let cLat=[], lLat=[], lDone=0, stop=false;
  const end = Date.now()+dur;
  async function cheapWorker(){ while(Date.now()<end){ const t=process.hrtime.bigint(); await hit('/cheap'); cLat.push(Number(process.hrtime.bigint()-t)/1e6); } }
  async function loginWorker(){
    while(Date.now()<end){ const t=process.hrtime.bigint(); await hit(loginPath); lLat.push(Number(process.hrtime.bigint()-t)/1e6); lDone++; }
  }
  const t0=Date.now();
  await Promise.all([ ...Array.from({length:cheapConc},cheapWorker), ...Array.from({length:loginRate},loginWorker) ]);
  const secs=(Date.now()-t0)/1000;
  const st=a=>{a.sort((x,y)=>x-y);const p=q=>a[Math.min(a.length-1,Math.floor(a.length*q))]?.toFixed(1);return `n=${a.length} p50=${p(.5)} p95=${p(.95)} p99=${p(.99)} max=${a[a.length-1]?.toFixed(1)}`;}
  console.log(`\n${label}`);
  console.log(`  cheap GET  ${(cLat.length/secs).toFixed(0)} req/s  ${st(cLat)} ms`);
  if (loginRate) console.log(`  ${loginPath.padEnd(7)}   ${(lDone/secs).toFixed(1)} req/s  ${st(lLat)} ms`);
}
await measure(32, 0, 4000, 'BASELINE: cheap GETs only');
await measure(32, 1, 6000, 'cheap GETs + 1 concurrent bcrypt(12) compare loop');
await measure(32, 4, 6000, 'cheap GETs + 4 concurrent bcrypt(12) compare loops');
await measure(32, 8, 6000, 'cheap GETs + 8 concurrent bcrypt(12) compare loops');
await measure(32, 4, 6000, 'cheap GETs + 4 concurrent bcrypt(10) PIN loops', '/pin');
