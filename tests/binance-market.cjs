const {test}=require('node:test');
const assert=require('node:assert/strict');
const api=require('../binance-market.js');
const fs=require('node:fs'),vm=require('node:vm');
const now=Date.parse('2026-10-27T12:00:00.000Z'),ms=now-300000;
const raw={symbol:'BTCUSDT',timestamp:ms+123,sumOpenInterest:'10',sumOpenInterestValue:'800000'};
test('Binance parser preserves original UTC time and rejects future, wrong venue and invalid numbers',()=>{
 const r=api.normalize(raw,'oi',now);assert.equal(Date.parse(r.time),ms+123);assert.equal(r.coin,10);assert.equal(r.usd,800000);assert.equal(r.contracts,undefined);
 for(const row of [{...raw,symbol:'ETHUSDT'},{...raw,timestamp:now+1},{...raw,sumOpenInterest:'NaN'},{...raw,sumOpenInterest:false}])assert.throws(()=>api.normalize(row,'oi',now));
});
test('mark candles use completed close boundary and never the open candle',()=>{
 const raw=[ms,'80000','81000','79000','80500','0',ms+299999];assert.equal(api.normalize(raw,'prices',now).time,new Date(now).toISOString());
 assert.equal(api.normalize([now,...raw.slice(1,6),now+299999],'prices',now),null);
 assert.throws(()=>api.normalize([ms,'80000','70000','79000','80500','0',ms+299999],'prices',now));
});
test('dataset merge cannot relabel OKX; preserves older real records and deduplicates timestamps',()=>{
 const a={...api.empty(),attempted_at:new Date(ms).toISOString(),records:[api.normalize(raw,'oi',now)]};
 const b={...api.empty(),attempted_at:new Date(now).toISOString(),states:{oi:{status:'failed'}}};
 const out=api.merge(a,b,now);assert.equal(out.records.length,1);assert.equal(out.records[0].time,a.records[0].time);assert.equal(out.states.oi.status,'failed');
 assert.equal(api.merge(a,a,now).records.length,1);assert.throws(()=>api.merge(a,{...b,venue:'okx'},now));
 assert.equal(api.merge({...a,records:[{...a.records[0],time:new Date(now+1).toISOString()}]},b,now).records.length,0);
});
test('refresh aligns to five-minute boundaries and Beijing time never depends on computer timezone',()=>{
 assert.equal(api.delay(now+20000),295000);assert.equal(api.delay(now),315000);
 const stamp=api.normalize(raw,'oi',now).time;
 const clock=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false});
 assert.equal(clock.format(new Date(stamp)),'19:55');
});
test('browser performs real-shaped endpoint pagination, schedules five-minute refresh and prevents overlapping runs',async()=>{
 let clock=now,id=0;const timers=new Map(),calls=[],listeners={},saved=new Map(),c={};
 class Clock extends Date{static now(){return clock;}}
 const rawOI=Array.from({length:600},(_,i)=>({...raw,timestamp:now-(600-i)*300000}));
 const rawPrice=rawOI.map(r=>[r.timestamp,'80000','81000','79000','80500','0',r.timestamp+299999]);
 const context={window:c,Date:Clock,URL,AbortController,console,
  localStorage:{getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)},
  document:{hidden:false,addEventListener:(k,fn)=>listeners[k]=fn},
  setTimeout:(fn,ms)=>{timers.set(++id,{fn,ms});return id;},clearTimeout:i=>timers.delete(i),
  fetch:async value=>{
   const url=String(value);calls.push(url);
   if(url.startsWith('binance-oi-minutes.json'))return {ok:true,json:async()=>api.empty()};
   const u=new URL(url);assert.equal(u.origin,'https://fapi.binance.com');assert.equal(u.searchParams.get('symbol'),'BTCUSDT');
   const isOI=u.pathname.includes('openInterestHist'),rows=isOI?rawOI:rawPrice;
   const inside=rows.filter(r=>{const t=isOI?r.timestamp:r[0];return t>=Number(u.searchParams.get('startTime'))&&t<=Number(u.searchParams.get('endTime'));});
   return {ok:true,json:async()=>isOI?inside.slice(-500):inside.slice(0,500)};
  }};
 vm.runInNewContext(fs.readFileSync('binance-market.js','utf8'),context);
 c.refreshBinanceOI();c.refreshBinanceOI();
 for(let i=0;i<20;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(c.BINANCE_OI_MINUTES_DATA.records.length,600);assert.equal(c.BINANCE_OI_MINUTES_DATA.prices.length,600);
 assert.equal(c.BINANCE_OI_MINUTES_DATA.states.oi.status,'ok');assert.equal(calls.length,5);
 assert.match(c.BINANCE_LIVE_STATUS.message,/直连成功/);
 const scheduled=[...timers.values()];assert.equal(scheduled.length,1);assert.equal(scheduled[0].ms,315000);
 clock+=315000;scheduled[0].fn();
 for(let i=0;i<20;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls.length,8);assert.equal(c.BINANCE_OI_MINUTES_DATA.records.length,600);
 assert.equal(c.BINANCE_OI_MINUTES_DATA.attempted_at,new Date(clock).toISOString());
});
