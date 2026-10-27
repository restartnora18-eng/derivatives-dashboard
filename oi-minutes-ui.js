'use strict';
(function(){
 const fmt=(v,d=2)=>Number.isFinite(v)?v.toLocaleString('zh-CN',{maximumFractionDigits:d}):'—';
 function select(data,hours,unit,now=Date.now()){
  const start=now-hours*36e5,valid=r=>Date.parse(r.time)>=start&&Date.parse(r.time)<=now;
  const rows=(data.records||[]).filter(r=>valid(r)&&Number.isFinite(r[unit])).sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
  const prices=(data.prices||[]).filter(r=>valid(r)&&Number.isFinite(r.price)).sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
  let missing=0;for(let i=1;i<rows.length;i++)missing+=Math.max(0,Math.round((Date.parse(rows[i].time)-Date.parse(rows[i-1].time))/3e5)-1);
  return {rows,prices,bounds:[start,now],missing,change:rows.length>1&&rows[0][unit]>0?(rows.at(-1)[unit]/rows[0][unit]-1)*100:null};
 }
 function chart(rows,key,bounds,title,unit,color){
  if(!rows.length)return '<div class="empty">区间内暂无真实5分钟观测，等待下一次云端补采。</div>';
  const vals=rows.map(r=>r[key]),lo=Math.min(...vals),hi=Math.max(...vals),pad=(hi-lo)*.08||Math.max(Math.abs(hi)*.001,.01),x=t=>100+(t-bounds[0])/(bounds[1]-bounds[0])*795,y=v=>210-(v-lo+pad)/(hi-lo+2*pad)*175;
  let paths='',path='';rows.forEach((r,i)=>{if(i&&Date.parse(r.time)-Date.parse(rows[i-1].time)>450000){paths+=`<path d="${path}"/>`;path='';}path+=`${path?'L':'M'}${x(Date.parse(r.time))},${y(r[key])} `;});if(path)paths+=`<path d="${path}"/>`;
  const clock=t=>new Date(t).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false,hour:'2-digit',minute:'2-digit'});
  const ticks=Array.from({length:7},(_,i)=>bounds[0]+(bounds[1]-bounds[0])*i/6);
  return `<svg viewBox="0 0 950 260" role="img" aria-label="${esc(title)}，5分钟真实采样，单位${esc(unit)}" style="width:100%"><g fill="#8c9eb3" font-size="10">${[lo,(lo+hi)/2,hi].map(v=>`<text x="4" y="${y(v)+4}">${fmt(v)}</text><line x1="100" x2="895" y1="${y(v)}" y2="${y(v)}" stroke="#2c3c4b"/>`).join('')}${ticks.map((t,i)=>`<line x1="${x(t)}" x2="${x(t)}" y1="25" y2="215" stroke="#293744"/><text x="${x(t)}" y="235" text-anchor="middle">${clock(t)}</text>${bounds[1]-bounds[0]>864e5?`<text x="${x(t)}" y="250" text-anchor="middle">${new Date(t).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit'})}</text>`:''}`).join('')}</g><g fill="none" stroke="${color}" stroke-width="1.8">${paths}</g>${rows.map(r=>`<circle cx="${x(Date.parse(r.time))}" cy="${y(r[key])}" r="1.6" fill="${color}"><title>${date(r.time)} · ${fmt(r[key],4)} ${esc(unit)}</title></circle>`).join('')}</svg>`;
 }
 function overlay(view,key,unit){
  const series=[{id:'price',label:'价格',unit:'USDT',rows:view.prices.filter(r=>Number.isFinite(r.price)),key:'price',color:'#a6b8f7'},{id:'oi',label:'未平仓量',unit,rows:view.rows.filter(r=>Number.isFinite(r[key])),key,color:'#c7ec96'}];
  if(series.every(s=>!s.rows.length))return '<div class="empty">区间内暂无真实5分钟观测，等待下一次云端补采。</div>';
  const x=t=>115+(t-view.bounds[0])/(view.bounds[1]-view.bounds[0]||1)*800;
  for(const s of series){
   const vals=s.rows.map(r=>r[s.key]),lo=Math.min(...vals),hi=Math.max(...vals),pad=(hi-lo)*.08||Math.max(Math.abs(hi)*.001,.01);
   s.min=s.rows.length?Math.max(0,lo-pad):0;s.max=s.rows.length?hi+pad:1;
   s.y=v=>365-(v-s.min)/(s.max-s.min||1)*310;
  }
  const time=t=>new Date(t).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false,hour:'2-digit',minute:'2-digit'});
  let svg=`<svg viewBox="0 0 1100 430" role="img" aria-label="BTC价格与未平仓量同图对照，共用分钟时间轴，左轴USDT价格，右轴${esc(unit)}未平仓量" class="minute-oi-overlay"><defs><clipPath id="minute-oi-clip"><rect x="115" y="45" width="800" height="330"/></clipPath></defs><rect x="115" y="45" width="800" height="330" fill="#101a1b"/><text x="115" y="25" fill="#a6b8f7" font-size="12">价格 · USDT（左轴）</text><text x="915" y="25" text-anchor="end" fill="#c7ec96" font-size="12">未平仓量 · ${esc(unit)}（右轴）</text>`;
  for(let i=0;i<5;i++){
   const t=i/4,y=365-t*310;svg+=`<line x1="115" x2="915" y1="${y}" y2="${y}" stroke="#2c3c4b"/>`;
   series.forEach((s,index)=>{svg+=`<text x="${index?930:100}" y="${y+4}" text-anchor="${index?'start':'end'}" fill="${s.color}" font-size="11">${s.rows.length?fmt(s.min+(s.max-s.min)*t):'—'}</text>`;});
  }
  for(let i=0;i<7;i++){
   const t=view.bounds[0]+(view.bounds[1]-view.bounds[0])*i/6;
   svg+=`<line x1="${x(t)}" x2="${x(t)}" y1="45" y2="375" stroke="#273637"/><text x="${x(t)}" y="399" text-anchor="middle" fill="#8c9eb3" font-size="11">${time(t)}</text>`;
   if(view.bounds[1]-view.bounds[0]>864e5)svg+=`<text x="${x(t)}" y="418" text-anchor="middle" fill="#8c9eb3" font-size="10">${new Date(t).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit'})}</text>`;
  }
  for(const s of series){
   let path='',paths='';s.rows.forEach((r,i)=>{if(i&&Date.parse(r.time)-Date.parse(s.rows[i-1].time)>450000){paths+=`<path d="${path}"/>`;path='';}path+=`${path?'L':'M'}${x(Date.parse(r.time))},${s.y(r[s.key])} `;});if(path)paths+=`<path d="${path}"/>`;
   svg+=`<g data-oi-series="${s.id}" clip-path="url(#minute-oi-clip)"><g fill="none" stroke="${s.color}" stroke-width="2">${paths}</g>${s.rows.map(r=>`<circle cx="${x(Date.parse(r.time))}" cy="${s.y(r[s.key])}" r="1.8" fill="${s.color}"><title>${date(r.time)} · ${s.label} ${fmt(r[s.key],4)} ${esc(s.unit)}</title></circle>`).join('')}</g>`;
  }
  return svg+'</svg>';
 }
 window.MinuteOI={select,chart,overlay};
 window.renderMinuteOI=function(target){
  const data=window.OI_MINUTES_DATA||{records:[],prices:[],states:{}};
  target.innerHTML=`<section class="panel minute-oi"><div class="panelhead"><div><h2>BTC 未平仓量 · 分钟研究</h2><p>OKX · BTC-USDT-SWAP · 真实5分钟历史</p></div><span class="badge">5 MIN / BTC</span></div><div class="controls"><select id="minute-oi-hours" aria-label="BTC分钟OI时间范围"><option value="6">最近6小时</option><option value="24" selected>最近24小时</option><option value="72">最近3天</option><option value="120">最近5天</option></select><select id="minute-oi-unit" aria-label="BTC分钟OI单位"><option value="coin">BTC 数量</option><option value="usd">USD 名义金额</option><option value="contracts">合约张数</option></select><button id="minute-oi-export">导出当前区间 CSV</button></div><div id="minute-oi-result"></div><details><summary>采样周期、更新时间与口径</summary><p>OI来自OKX合约级历史接口，每个真实点相隔5分钟。1分钟历史不受该接口支持，不插值、不补零。来源合约与上面的BTC小时快照一致，ETH小时数据仍可在下方查看。历史首次回补最近约5天，以后云端约每小时抓取新增5分钟记录，并滚动保存30天；记录密度不等于网页每5分钟刷新。</p><p>价格使用同一BTC-USDT永续的已完成5分钟标记价K线收盘价，放在该K线结束时刻；OI按接口原始时间戳。两者不是同一瞬时报价。两条线叠放在同一图，共用时间轴；左轴为USDT价格，右轴为所选OI单位，各自缩放，保留各自真实时间戳。相邻OI或价格超过7.5分钟缺口断线。上方变化是当前区间首末值变化，OI增加不单独代表看多。</p><p>坐标显示北京时间 HH:mm，悬停查看完整日期、数值与单位；跨日可结合范围起止时间查看。USD OI同时受价格和仓位数量影响，优先对照BTC数量。<a href="https://www.okx.com/docs-v5/en/#trading-statistics-rest-api-get-contract-open-interest-history" target="_blank" rel="noopener">OKX历史OI接口说明 ↗</a></p></details></section><details class="minute-oi-legacy"><summary>展开原有 BTC / ETH 小时快照与历史</summary><div id="minute-oi-hourly"></div></details>`;
  const hours=target.querySelector('#minute-oi-hours'),unit=target.querySelector('#minute-oi-unit');let current;
  function draw(){
   const now=Date.now(),key=unit.value,label=key==='coin'?'BTC':key==='usd'?'USD':'张',view=select(data,Number(hours.value),key,now),last=view.rows.at(-1),latestPrice=view.prices.at(-1);current={view,key,label};
   const state=data.states?.oi,priceState=data.states?.prices,status=s=>s?.status==='ok'?'成功':s?.status==='partial'?'部分成功':'未成功';
   const cutoffText=date(new Date(view.bounds[0]).toISOString()),endText=date(new Date(view.bounds[1]).toISOString());
   target.querySelector('#minute-oi-result').innerHTML=`<p class="hint">云端补采：${date(data.attempted_at)} · OI ${status(state)} ${esc(state?.code||'')} · 价格 ${status(priceState)} ${esc(priceState?.code||'')}<br>当前区间：${cutoffText} — ${endText}</p><div class="oi-stats"><div class="stat"><span class="label">最近5分钟OI观测 · ${label}</span><div class="value">${last?fmt(last[key]):'—'}</div><small>${date(last?.time)}${last&&now-Date.parse(last.time)>90*60000?' · 数据已过期':''}</small></div><div class="stat"><span class="label">区间首末OI变化</span><div class="value">${view.change===null?'—':pct(view.change)}</div><small>${view.rows.length} 个真实点 · 内部缺少 ${view.missing} 个5分钟格</small></div></div><h3>价格 × 未平仓量 · 同图对照</h3><div class="minute-oi-legend"><span class="minute-price-label"><i></i>价格（左轴） <strong>${latestPrice?fmt(latestPrice.price):'—'} USDT</strong> · ${view.prices.length} 根已完成5分钟K线</span><span class="minute-position-label"><i></i>OI（右轴） <strong>${last?fmt(last[key]):'—'} ${label}</strong> · ${view.rows.length} 个真实点</span></div><div class="minute-oi-overlay-wrap">${overlay(view,key,label)}</div><p class="hint">左右轴各自缩放，曲线交叉不代表两个数值相等，斜率不能直接比较。价格最后收盘：${date(latestPrice?.time)}。</p><p class="hint">区间首末真实OI覆盖：${date(view.rows[0]?.time)} — ${date(last?.time)}。缺失格不补值，样本范围外不外推。</p>`;
  }
  hours.addEventListener('change',draw);unit.addEventListener('change',draw);draw();
  target.querySelector('#minute-oi-export').addEventListener('click',()=>{
   const {view}=current,rows=[['type','contract','source_time_utc','contracts','oi_btc','oi_usd','mark_close_usdt','candle_open_utc']];
   for(const r of view.rows)rows.push(['oi','BTC-USDT-SWAP',r.time,r.contracts,r.coin,r.usd,'','']);
   for(const r of view.prices)rows.push(['mark_close','BTC-USDT-SWAP',r.time,'','','',r.price,r.opened_at]);
   const csv='\ufeff'+rows.map(r=>r.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\r\n'),url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=`Kimra-BTC-OI-5m-${hours.value}h.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  let mounted=false;target.querySelector('.minute-oi-legacy').addEventListener('toggle',e=>{if(e.target.open&&!mounted){mounted=true;window.renderOI(target.querySelector('#minute-oi-hourly'));}});
 };
})();
