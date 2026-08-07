import http from 'http';
const TOKEN = process.env.TOK;
const agent = new http.Agent({ keepAlive: true, maxSockets: 128 });
function hit(path, gzip) {
  return new Promise((resolve) => {
    const req = http.request({ port:5399, path, agent, headers: { authorization: 'Bearer '+TOKEN, ...(gzip?{'accept-encoding':'gzip'}:{}) } }, (res) => {
      let n=0; res.on('data', c=>n+=c.length); res.on('end', ()=>resolve({ code:res.statusCode, n }));
    });
    req.on('error', ()=>resolve({code:0,n:0})); req.end();
  });
}
async function bench(path, { gzip=false, conc=48, dur=5000, label }={}) {
  let done=0, err=0, bytes=0, lat=[];
  const end = Date.now()+dur;
  async function worker(){ while(Date.now()<end){ const t=process.hrtime.bigint(); const r=await hit(path,gzip); if(r.code>=400||r.code===0)err++; bytes+=r.n; lat.push(Number(process.hrtime.bigint()-t)/1e6); done++; } }
  const t0=Date.now();
  await Promise.all(Array.from({length:conc},worker));
  const secs=(Date.now()-t0)/1000;
  lat.sort((a,b)=>a-b);
  const p=q=>lat[Math.min(lat.length-1,Math.floor(lat.length*q))]?.toFixed(1);
  console.log(`${(label||path).padEnd(30)} ${(done/secs).toFixed(0).padStart(6)} req/s  err=${err}  p50=${p(0.5)} p95=${p(0.95)} p99=${p(0.99)} ms  respBytes=${(bytes/done).toFixed(0)}`);
  return done/secs;
}
// warm
await bench('/raw',{dur:2500,label:'(warmup)'});
const raw = await bench('/raw',{label:'node http, zero middleware'});
const bare = await bench('/api/bare',{label:'full middleware stack only'});
const jwtonly = await bench('/api/jwtonly',{label:'stack + jwt.verify only'});
const prot = await bench('/api/protect-only',{label:'stack + protect CPU (2 hydrates)'});
const me = await bench('/api/me',{label:'+ toSafeJSON (GET /auth/me shape)'});
const chats = await bench('/api/chats',{label:'GET /chats 24KB, no gzip'});
const chatsz = await bench('/api/chats',{gzip:true,label:'GET /chats 24KB, gzip'});
const us = (r) => (1e6/r).toFixed(0);
console.log('\n--- per-request cost (us of wall time at saturation, 1 process) ---');
console.log('node baseline            ', us(raw));
console.log('middleware stack         ', us(bare), ` (delta vs baseline: ${(1e6/bare-1e6/raw).toFixed(0)} us)`);
console.log('+jwt.verify              ', us(jwtonly), ` (delta: ${(1e6/jwtonly-1e6/bare).toFixed(0)} us)`);
console.log('+2 mongoose hydrates     ', us(prot), ` (delta: ${(1e6/prot-1e6/jwtonly).toFixed(0)} us)`);
console.log('+toSafeJSON              ', us(me), ` (delta: ${(1e6/me-1e6/prot).toFixed(0)} us)`);
console.log('chats 24KB nogzip        ', us(chats));
console.log('chats 24KB gzip          ', us(chatsz), ` (gzip delta: ${(1e6/chatsz-1e6/chats).toFixed(0)} us)`);
