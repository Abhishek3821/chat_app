// Audit fixtures must never call real email/push/payment/TURN providers.
const {createRequire}=require('node:module');
const local=(host)=>['127.0.0.1','localhost','::1','[::1]'].includes(String(host||'').split(':')[0])||['::1','[::1]'].includes(String(host));
for(const name of ['node:http','node:https']) {
  const mod=require(name),original=mod.request;
  mod.request=function(input,...args) {
    let host;
    if(typeof input==='string'||input instanceof URL) host=new URL(input).hostname;
    else host=input?.hostname||input?.host||'localhost';
    if(!local(host)) throw new Error('Audit blocked external network request');
    return original.call(this,input,...args);
  };
}
const originalFetch=globalThis.fetch;
globalThis.fetch=function(input,...args) {
  const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
  if(!local(url.hostname)) return Promise.reject(new Error('Audit blocked external fetch'));
  return originalFetch.call(this,input,...args);
};
if(process.env.AUDIT_MOCK_PUSH==='1') {
  const webpush=createRequire(process.cwd()+'/package.json')('web-push');
  webpush.sendNotification=async()=>{const error=new Error('Simulated expired audit subscription');error.statusCode=410;throw error;};
}
