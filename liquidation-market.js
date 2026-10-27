'use strict';
(function(root){
 const STEP=300000,BASE='https://www.okx.com/api/v5',STORE='kimra-okx-liquidations-5m-v1';
 function numeric(v){if(v==null||v===''||typeof v==='boolean'||!Number.isFinite(Number(v)))throw Error('invalid_number');return Number(v);}
 function key(r){return [r.contract,r.time,r.pos_side,r.order_side,Number(r.bankruptcy_price),Number(r.raw_sz)].join('|');}
 function events(payload,symbol,now){
  if(String(payload?.code)!=='0'||!Array.isArray(payload.data))throw Error('api_error');
  const rows=new Map();let returned=0,rejected=0,matched=false;
  for(const group of payload.data){
   if(group.instType!=='SWAP'||group.instId!==symbol+'-USDT-SWAP')continue;matched=true;
   if(!Array.isArray(group.details))throw Error('invalid_details');
   for(const item of group.details){returned++;try{
    const time=numeric(item.ts),price=numeric(item.bkPx),size=numeric(item.sz),side=item.posSide;
    if(!Number.isSafeInteger(time)||time>now||time<now-30*864e5||price<=0||size<=0||!['long','short'].includes(side)||item.side!==(side==='long'?'sell':'buy'))throw Error('invalid_event');
    const r={symbol,contract:group.instId,venue:'okx',time:new Date(time).toISOString(),pos_side:side,order_side:item.side,bankruptcy_price:price,raw_sz:String(item.sz),first_seen:new Date(now).toISOString()};r.id=key(r);rows.set(r.id,r);
   }catch(_){rejected++;}}
  }
  if(payload.data.length&&!matched)throw Error('contract_mismatch');
  if(returned&&!rows.size)throw Error('no_valid_samples');
  return {rows:[...rows.values()],state:{status:rejected?'partial':'ok',returned,rejected,limit_reached:returned>=100,experimental:true}};
 }
 function candle(row,symbol,now){
  if(!Array.isArray(row)||row.length<6)throw Error('invalid_candle');
  const ms=numeric(row[0]);if(!Number.isSafeInteger(ms)||ms<=0||ms%STEP)throw Error('invalid_time');
  if(row[5]!=='1'||ms+STEP>now)return null;
  const [open,high,low,close]=row.slice(1,5).map(numeric);
  if(Math.min(open,high,low,close)<=0||low>Math.min(open,close)||high<Math.max(open,close))throw Error('invalid_price');
  return {symbol,contract:symbol+'-USDT-SWAP',venue:'okx',interval_minutes:5,time:new Date(ms+STEP).toISOString(),opened_at:new Date(ms).toISOString(),price:close,open,high,low,close};
 }
 function merge(a,b,kind,now=Date.now()){
  const rows=new Map(),valid=r=>r.venue==='okx'&&['BTC','ETH'].includes(r.symbol)&&r.contract===r.symbol+'-USDT-SWAP'&&Date.parse(r.time)<=now&&Date.parse(r.time)>=now-30*864e5;
  for(const r of [...a,...b]){
   if(!valid(r))continue;
   if(kind==='events'&&(!['long','short'].includes(r.pos_side)||!Number.isFinite(r.bankruptcy_price)||r.bankruptcy_price<=0||!Number.isFinite(Number(r.raw_sz))||Number(r.raw_sz)<=0))continue;
   if(kind==='prices'&&(!Number.isFinite(r.price)||r.price<=0||r.interval_minutes!==5))continue;
   const id=kind==='events'?key(r):r.symbol+'|'+r.time;
   if(!rows.has(id))rows.set(id,r);
  }
  return [...rows.values()].sort((x,y)=>Date.parse(x.time)-Date.parse(y.time)).slice(kind==='events'?-10000:-17282);
 }
 const delay=now=>STEP-now%STEP+15000,api={events,candle,merge,delay};
 if(typeof module!=='undefined'&&module.exports){module.exports=api;return;}
 root.LiquidationMarket=api;
 let liq=root.LIQUIDATIONS_DATA||{records:[],states:{}},prices={venue:'okx',interval_minutes:5,records:[],states:{}},busy=false,lastAttempt=0,timer;
 function ingest(bundle){
  if(bundle?.venue!=='okx'||bundle.interval_minutes!==5)throw Error('wrong_dataset');
  for(const [kind,incoming] of [['events',bundle.liquidations],['prices',bundle.prices]]){
   if(!incoming)continue;const old=kind==='events'?liq:prices;
   const newer=(Date.parse(incoming.attempted_at)||0)>=(Date.parse(old.attempted_at)||0);
   const data={...old,...(newer?incoming:{}),records:merge(old.records||[],incoming.records||[],kind)};
   if(kind==='events')liq=data;else prices=data;
  }
 }
 try{const saved=localStorage.getItem(STORE);if(saved)ingest(JSON.parse(saved));}catch(_){}
 function publish(){
  if(liq.records.length>=10000)liq.storage_truncated=true;
  root.LIQUIDATIONS_DATA=liq;root.LIQUIDATION_PRICE_DATA=prices;
  try{localStorage.setItem(STORE,JSON.stringify({venue:'okx',interval_minutes:5,liquidations:liq,prices}));}catch(_){}
  if(typeof root.redrawLiquidationHeatmap==='function')root.redrawLiquidationHeatmap();
 }
 async function json(url){const ctrl=new AbortController(),timeout=setTimeout(()=>ctrl.abort(),12000);try{const r=await fetch(url,{signal:ctrl.signal,cache:'no-store',credentials:'omit'});if(!r.ok)throw Error('HTTP '+r.status);return await r.json();}finally{clearTimeout(timeout);}}
 async function fetchPrices(symbol,now){
  const old=prices.records.filter(r=>r.symbol===symbol),stop=Math.max(now-864e5,(Date.parse(old.at(-1)?.time)||0)-STEP),found=[];let after,oldest=Infinity,rejected=0;
  for(let page=0;page<5;page++){
   const url=new URL(BASE+'/market/history-mark-price-candles');for(const [k,v] of Object.entries({instId:symbol+'-USDT-SWAP',bar:'5m',limit:100,...(after?{after}: {})}))url.searchParams.set(k,v);
   const p=await json(url.toString());if(String(p.code)!=='0'||!Array.isArray(p.data))throw Error('api_error');if(!p.data.length)break;
   let min=Infinity;for(const row of p.data){try{const r=candle(row,symbol,now);min=Math.min(min,numeric(row[0]));if(r&&Date.parse(r.time)>=now-864e5)found.push(r);}catch(_){rejected++;}}
   if(!Number.isFinite(min)||min>=oldest)throw Error('pagination_stalled');oldest=min;
   if(min<=stop||p.data.length<100)break;if(page===4)throw Error('page_limit');after=String(min-1);
  }
  if(!found.length)throw Error('no_data');return {rows:found,state:{status:rejected?'partial':'ok',received:found.length,rejected}};
 }
 async function refresh(){
  if(busy)return;busy=true;clearTimeout(timer);lastAttempt=Date.now();root.LIQUIDATION_LIVE_STATUS='正在请求5分钟强平样本与标记价格…';publish();
  const cloud=json('liquidation-minutes.json?t='+lastAttempt).then(ingest).catch(()=>{});
  const requests=[];for(const symbol of ['BTC','ETH'])requests.push({symbol,kind:'events',promise:json(BASE+'/public/liquidation-orders?instType=SWAP&uly='+symbol+'-USDT&state=filled&limit=100').then(p=>events(p,symbol,lastAttempt))},{symbol,kind:'prices',promise:fetchPrices(symbol,lastAttempt)});
  const result=await Promise.allSettled(requests.map(r=>r.promise));await cloud;
  liq={...liq,states:{...liq.states},attempted_at:new Date(lastAttempt).toISOString()};prices={...prices,states:{...prices.states},attempted_at:liq.attempted_at};
  result.forEach((r,i)=>{const {symbol,kind}=requests[i],data=kind==='events'?liq:prices;if(r.status==='fulfilled'){data.records=merge(data.records,r.value.rows,kind);data.states[symbol]=r.value.state;}else data.states[symbol]={status:'failed',code:String(r.reason?.message||'network_error')};});
  root.LIQUIDATION_LIVE_STATUS=result.every(r=>r.status==='fulfilled')?'每5分钟自动更新 · 北京时间 UTC+8':'部分请求失败，保留原时间数据 · 每5分钟重试';busy=false;publish();timer=setTimeout(refresh,delay(Date.now()));
 }
 root.refreshLiquidationMinutes=refresh;publish();refresh();
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&Date.now()-lastAttempt>=STEP)refresh();});
})(typeof window==='undefined'?globalThis:window);
