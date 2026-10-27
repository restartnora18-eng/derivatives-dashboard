'use strict';
(function(root){
 const STEP=300000, BASE='https://fapi.binance.com', CONTRACT='BTCUSDT';
 const endpoints={oi:'/futures/data/openInterestHist',prices:'/fapi/v1/markPriceKlines'};
 const empty=()=>({schema_version:1,venue:'binance',symbol:'BTC',contract:CONTRACT,interval_minutes:5,records:[],prices:[],states:{}});
 function number(v){if(v===null||v===''||typeof v==='boolean'||!Number.isFinite(Number(v)))throw Error('invalid_number');return Number(v);}
 function normalize(row,kind,now){
  if(kind==='oi'){
   if(!row||row.symbol!==CONTRACT)throw Error('wrong_contract');
   const ms=number(row.timestamp),coin=number(row.sumOpenInterest),usd=number(row.sumOpenInterestValue);
   if(!Number.isSafeInteger(ms)||ms<=0||ms>now||coin<0||usd<0)throw Error('invalid_oi');
   return {time:new Date(ms).toISOString(),coin,usd};
  }
  if(!Array.isArray(row)||row.length<7)throw Error('invalid_candle');
  const ms=number(row[0]),end=number(row[6]);
  if(!Number.isSafeInteger(ms)||ms<=0||ms%STEP||end!==ms+STEP-1)throw Error('invalid_candle_time');
  const [open,high,low,close]=row.slice(1,5).map(number);
  if(Math.min(open,high,low,close)<=0||low>Math.min(open,close)||high<Math.max(open,close))throw Error('invalid_price');
  if(ms+STEP>now)return null;
  return {time:new Date(ms+STEP).toISOString(),opened_at:new Date(ms).toISOString(),open,high,low,close,price:close};
 }
 function checked(bundle,now=Date.now()){
  if(bundle?.venue!=='binance'||bundle.contract!==CONTRACT||bundle.interval_minutes!==5)throw Error('wrong_dataset');
  const valid=(r,key)=>r&&Number.isFinite(Date.parse(r.time))&&Date.parse(r.time)<=now&&Date.parse(r.time)>=now-30*864e5&&Number.isFinite(r[key])&&r[key]>=0;
  return {...empty(),...bundle,records:(bundle.records||[]).filter(r=>valid(r,'coin')&&valid(r,'usd')),prices:(bundle.prices||[]).filter(r=>valid(r,'price')&&r.price>0)};
 }
 function merge(previous,incoming,now=Date.now()){
  const a=checked(previous,now),b=checked(incoming,now),out={...a};
  for(const key of ['records','prices'])out[key]=[...new Map([...a[key],...b[key]].map(r=>[r.time,r])).values()].sort((x,y)=>Date.parse(x.time)-Date.parse(y.time)).slice(-8641);
  if((Date.parse(b.attempted_at)||0)>=(Date.parse(a.attempted_at)||0)){out.attempted_at=b.attempted_at;out.states=b.states;}
  return out;
 }
 const delay=now=>STEP-now%STEP+15000;
 const api={STEP,normalize,checked,merge,empty,delay};
 if(typeof module!=='undefined'&&module.exports){module.exports=api;return;}
 root.BinanceMarket=api;
 const STORE='kimra-binance-btc-oi-5m-v1';
 let data=empty(),busy=false,timer,lastAttempt=0;
 try{const cached=localStorage.getItem(STORE);if(cached)data=checked(JSON.parse(cached));}catch(_){}
 root.BINANCE_OI_MINUTES_DATA=data;
 root.BINANCE_LIVE_STATUS={message:'正在连接 Binance…'};
 function publish(){
  root.BINANCE_OI_MINUTES_DATA=data;
  try{localStorage.setItem(STORE,JSON.stringify(data));}catch(_){}
  if(typeof root.redrawMinuteOI==='function')root.redrawMinuteOI();
 }
 async function json(url){
  const control=new AbortController(),timeout=setTimeout(()=>control.abort(),12000);
  try{const r=await fetch(url,{cache:'no-store',signal:control.signal,credentials:'omit'});if(!r.ok)throw Error('HTTP '+r.status);return await r.json();}finally{clearTimeout(timeout);}
 }
 async function direct(kind,now){
  const key=kind==='oi'?'records':'prices',old=data[key],latest=old.length?Date.parse(old.at(-1).time):0;
  let cursor=data.states?.[kind]?.backfill_finished?Math.max(now-5*864e5,latest-STEP):now-5*864e5,pageEnd=now,rows=[],rejected=0;
  for(let page=0;page<4;page++){
   const url=new URL(BASE+endpoints[kind]);
   for(const [k,v] of Object.entries({symbol:CONTRACT,limit:500,startTime:cursor,endTime:pageEnd,[kind==='oi'?'period':'interval']:'5m'}))url.searchParams.set(k,v);
   const raw=await json(url.toString());if(!Array.isArray(raw))throw Error('invalid_response');
   let max=cursor-1,min=pageEnd+1;
   for(const r of raw){try{const item=normalize(r,kind,now),stamp=number(kind==='oi'?r.timestamp:r[0]);if(stamp<cursor||stamp>pageEnd)throw Error('invalid_time');max=Math.max(max,stamp);min=Math.min(min,stamp);if(item)rows.push(item);}catch(_){rejected++;}}
   if(!raw.length||raw.length<500)break;
   if(max<cursor)throw Error('pagination_stalled');
   if(kind==='oi'){if(min-1>=pageEnd)throw Error('pagination_stalled');pageEnd=min-1;if(pageEnd<cursor)break;}
   else{cursor=max+1;if(cursor>pageEnd)break;}
   if(page===3)throw Error('page_limit');
  }
  if(!rows.length)throw Error('no_data');
  return {key,rows,state:{status:rejected?'partial':'ok',received:rows.length,rejected,backfill_finished:!rejected}};
 }
 async function refresh(){
  if(busy)return;busy=true;lastAttempt=Date.now();clearTimeout(timer);
  root.BINANCE_LIVE_STATUS={message:'正在向 Binance 请求数据…',attempted_at:new Date(lastAttempt).toISOString()};publish();
  // A same-origin cloud snapshot remains usable if this network cannot reach Binance.
  // It retains its original timestamps and is never presented as a fresh direct response.
  const cloud=json('binance-oi-minutes.json?t='+lastAttempt).then(b=>{data=merge(data,b);publish();}).catch(()=>{});
  const results=await Promise.allSettled(['oi','prices'].map(k=>direct(k,lastAttempt)));
  await cloud;
  const attempt={...empty(),attempted_at:new Date(lastAttempt).toISOString()};
  results.forEach((r,i)=>{const kind=i?'prices':'oi';if(r.status==='fulfilled'){attempt[r.value.key]=r.value.rows;attempt.states[kind]=r.value.state;}else attempt.states[kind]={status:'failed',code:String(r.reason?.message||'network_error')};});
  data=merge(data,attempt);
  const success=results.filter(r=>r.status==='fulfilled').length;
  root.BINANCE_LIVE_STATUS={message:success===2?'Binance 直连成功 · 每5分钟自动更新':success?'Binance 部分请求失败 · 保留已验证数据':'Binance 直连失败 · 保留原时间数据，5分钟后重试',attempted_at:attempt.attempted_at};
  busy=false;publish();timer=setTimeout(refresh,delay(Date.now()));
 }
 root.refreshBinanceOI=refresh;
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&Date.now()-lastAttempt>=STEP)refresh();});
 refresh();
})(typeof window==='undefined'?globalThis:window);
