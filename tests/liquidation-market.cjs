const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const api=require('../liquidation-market.js'),now=Date.parse('2026-10-27T12:00:00.000Z'),ms=now-300000;
const payload=(symbol='BTC')=>({code:'0',data:[{instType:'SWAP',instId:symbol+'-USDT-SWAP',details:[{ts:String(ms),posSide:'long',side:'sell',bkPx:'80000.00',sz:'1.00'}]}]});
test('liquidation event validation preserves time and deduplicates numeric variants without inventing notional',()=>{
 const p=payload();p.data[0].details.push({...p.data[0].details[0],bkPx:'80000',sz:'1'});
 const result=api.events(p,'BTC',now);assert.equal(result.rows.length,1);assert.equal(result.state.returned,2);assert.equal(result.rows[0].time,new Date(ms).toISOString());assert.equal(result.rows[0].notional,undefined);
 assert.throws(()=>api.events(payload('ETH'),'BTC',now));
 p.data[0].details=[{...p.data[0].details[0],ts:String(now+1)}];assert.throws(()=>api.events(p,'BTC',now));
});
test('only completed five-minute OKX mark candles enter the line',()=>{
 const r=api.candle([String(ms),'80000','81000','79000','80500','1'],'BTC',now);assert.equal(r.time,new Date(now).toISOString());assert.equal(r.price,80500);
 assert.equal(api.candle([String(ms),'80000','81000','79000','80500','0'],'BTC',now),null);
 assert.equal(api.candle([String(now),'80000','81000','79000','80500','1'],'BTC',now),null);
 assert.throws(()=>api.candle([String(ms),'80000','70000','79000','80500','1'],'BTC',now));
});
test('cloud hashes and browser fingerprints merge once; wrong venues and future records cannot enter',()=>{
 const r=api.events(payload(),'BTC',now).rows[0],saved={...r,id:'cloud-sha'};
 const rows=api.merge([saved],[r,{...r,venue:'binance'},{...r,time:new Date(now+1).toISOString()}],'events',now);
 assert.equal(rows.length,1);assert.equal(rows[0].id,'cloud-sha');assert.equal(api.merge(rows,[],'events',now)[0].time,saved.time);
 assert.equal(api.delay(now+20000),295000);
});
test('browser collects BTC and ETH once per five-minute cycle, retains records on failures and prevents overlapping requests',async()=>{
 let clock=now,fail=false,id=0;const calls=[],timers=new Map(),root={LIQUIDATIONS_DATA:{records:[],states:{}}};class Clock extends Date{static now(){return clock;}}
 const context={window:root,Date:Clock,URL,AbortController,localStorage:{getItem:()=>null,setItem:()=>{}},document:{hidden:false,addEventListener:()=>{}},setTimeout:(fn,ms)=>{timers.set(++id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),fetch:async value=>{
  const text=String(value);calls.push(text);if(text.startsWith('liquidation-minutes.json'))return {ok:true,json:async()=>({venue:'okx',interval_minutes:5})};
  if(fail)throw Error('network_error');const u=new URL(text),symbol=(u.searchParams.get('uly')||u.searchParams.get('instId')).split('-')[0];assert.equal(u.origin,'https://www.okx.com');
  return {ok:true,json:async()=>u.pathname.includes('liquidation-orders')?payload(symbol):{code:'0',data:[[String(ms),'80000','81000','79000','80500','1']]}};
 }};
 vm.runInNewContext(fs.readFileSync('liquidation-market.js','utf8'),context);root.refreshLiquidationMinutes();
 for(let i=0;i<15;i++)await new Promise(r=>setImmediate(r));
 assert.equal(calls.length,5);assert.equal(root.LIQUIDATIONS_DATA.records.length,2);assert.equal(root.LIQUIDATION_PRICE_DATA.records.length,2);assert.equal(root.LIQUIDATION_PRICE_DATA.interval_minutes,5);assert.match(root.LIQUIDATION_LIVE_STATUS,/每5分钟自动更新/);
 const task=[...timers.values()];assert.equal(task.length,1);assert.equal(task[0].ms,315000);
 clock+=315000;fail=true;task[0].fn();for(let i=0;i<15;i++)await new Promise(r=>setImmediate(r));
 assert.equal(root.LIQUIDATIONS_DATA.records.length,2);assert.equal(root.LIQUIDATIONS_DATA.records[0].time,new Date(ms).toISOString());assert.equal(root.LIQUIDATIONS_DATA.states.BTC.status,'failed');assert.match(root.LIQUIDATION_LIVE_STATUS,/保留原时间/);
});
