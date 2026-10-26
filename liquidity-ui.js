'use strict';
(function(){
 const hour=36e5,fmt=(n,d=2)=>Number.isFinite(n)?n.toLocaleString('zh-CN',{maximumFractionDigits:d}):'—';
 const xText=(x,y,text,anchor='start')=>`<text x="${x}" y="${y}" text-anchor="${anchor}" fill="#8d96a8" font-size="10">${esc(text)}</text>`;
 function hourly(rows,start,end){
  const map=new Map();
  for(const r of rows){const t=Date.parse(r.time);if(!Number.isFinite(t)||t<start||t>end)continue;const h=Math.floor(t/hour);if(!map.has(h)||t>Date.parse(map.get(h).time))map.set(h,r);}
  return [...map.values()].sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
 }
 function snapshotFrame(s){
  const result={symbol:s.symbol,contract:s.contract,time:s.time,mid:s.mid,bin_bps:1};
  for(const side of ['bids','asks']){
   const coverage=s[side==='bids'?'bid_coverage_bps':'ask_coverage_bps'];const values=Array(50).fill(0);
   for(const l of s[side]){const off=(side==='bids'?s.mid-l.price:l.price-s.mid)/s.mid*10000;if(off>=0&&off<50)values[Math.floor(off)]+=l.notional;}
   result[side]=values.map((v,i)=>coverage>=i+1-1e-8?v:null);
  }
  return result;
 }
 function depthHeatmap(frames,symbol,start,end){
  frames=hourly(frames.filter(f=>f.symbol===symbol&&f.bin_bps===1&&Number.isFinite(f.mid)&&f.mid>0&&[...f.bids,...f.asks].some(v=>Number.isFinite(v)&&v>=0)),start,end);
  if(!frames.length)return '<div class="liquidity-empty">暂无深度快照，等待云端采集。</div>';
  const cells=[];
  for(const f of frames)for(const side of ['bids','asks'])for(let i=0;i<f[side].length;i++){
   const v=f[side][i];if(!Number.isFinite(v)||v<0)continue;
   const a=f.mid*(1+(side==='bids'?-i-1:i)/10000),b=f.mid*(1+(side==='bids'?-i:i+1)/10000);
   cells.push({f,side,v,a,b});
  }
  if(!cells.length)return '<div class="liquidity-empty">返回档位不足以覆盖完整 1 bps 桶；热力图留空。</div>';
  const lo=Math.min(...cells.map(c=>c.a)),hi=Math.max(...cells.map(c=>c.b)),pad=(hi-lo)*.03||1;
  const y=p=>250-(p-(lo-pad))/(hi-lo+2*pad)*218,x=t=>58+(t-start)/(end-start)*490;
  const max=Math.max(1,...cells.map(c=>c.v)),width=490*hour/(end-start);
  const color=v=>{const t=Math.log1p(v)/Math.log1p(max);return t<.55?`hsl(${275-t*100} 72% ${16+t*40}%)`:`hsl(${180-(t-.55)*330} 85% ${40+(t-.55)*35}%)`;};
  let paths='',path='';frames.forEach((f,i)=>{if(i&&Date.parse(f.time)-Date.parse(frames[i-1].time)>2*hour){paths+=`<path d="${path}"/>`;path='';}path+=`${path?'L':'M'}${x(Date.parse(f.time))},${y(f.mid)} `;});if(path)paths+=`<path d="${path}"/>`;
  return `<svg viewBox="0 0 570 285" role="img" aria-label="${esc(symbol)} 挂单深度历史热力图，横轴时间，纵轴价格USDT"><rect x="58" y="25" width="490" height="225" fill="#120c23"/>${[0,.5,1].map(t=>{const p=lo+(hi-lo)*t;return xText(52,y(p)+3,fmt(p),'end');}).join('')}${cells.map(c=>{const left=Math.max(start,Math.floor(Date.parse(c.f.time)/hour)*hour),right=Math.min(end,Math.floor(Date.parse(c.f.time)/hour)*hour+hour);return `<rect x="${x(left)}" y="${y(c.b)}" width="${Math.max(.2,x(right)-x(left))}" height="${Math.max(.3,y(c.a)-y(c.b))}" fill="${color(c.v)}"><title>${date(c.f.time)} · ${c.side==='bids'?'买盘':'卖盘'} · ${fmt(c.a)}–${fmt(c.b)} USDT · 挂单名义额 ${fmt(c.v)} USDT</title></rect>`;}).join('')}<g fill="none" stroke="#f1bf65" stroke-width="1.1">${paths}</g>${xText(58,275,date(new Date(start).toISOString()))}${xText(548,275,date(new Date(end).toISOString()),'end')}</svg><div class="liquidity-scale"><span>低</span><i></i><span>高 · 桶内挂单名义额 / USDT · 对数色阶</span></div><p class="liquidity-note">${frames.length} 个小时快照 · 金线为中间价 · 空白表示未采样或深度覆盖不足。每格仅代表一次快照，期间挂单变化未知。</p>`;
 }
 function scatter(data,now){
  const points=Object.values(data.snapshots||{}).filter(s=>Number.isFinite(s.spread_bps)&&Number.isFinite(s.top20_imbalance_pct)&&Date.parse(s.time)<=now+60000&&now-Date.parse(s.time)<=90*60000&&data.states?.[s.symbol]?.status==='ok');
  const max=Math.max(.1,...points.map(s=>s.spread_bps))*1.25,x=v=>60+v/max*470,y=v=>145-v/100*100;
  return `<svg viewBox="0 0 570 285" role="img" aria-label="币种流动性对比，横轴买卖价差bps，纵轴各侧前20档失衡百分比"><rect x="60" y="30" width="470" height="215" fill="#0b1017"/><line x1="60" x2="530" y1="145" y2="145" stroke="#834257"/>${[-100,0,100].map(v=>xText(53,y(v)+3,v+'%','end')).join('')}${[0,.5,1].map(t=>xText(x(max*t),262,fmt(max*t,3),'middle')).join('')}${points.map(s=>`<circle cx="${x(s.spread_bps)}" cy="${y(s.top20_imbalance_pct)}" r="7" fill="${s.symbol==='BTC'?'#f5c06a':'#82c7e7'}" stroke="#111"><title>${esc(s.contract)} · ${date(s.time)} · 价差 ${fmt(s.spread_bps,4)} bps · 前20档失衡 ${fmt(s.top20_imbalance_pct)}%</title></circle>${xText(x(s.spread_bps)+11,y(s.top20_imbalance_pct)-8,s.symbol)}`).join('')}${xText(295,282,'买卖价差 / bps','middle')}${xText(68,18,'前20档失衡 / %')}</svg><p class="liquidity-note">${points.length} / 2 个币种可比较 · 上方买盘名义额较多，下方卖盘较多。只显示本次采集成功且未过期的点；各币种来源时间可能不同。</p>`;
 }
 function screener(data,key,start,end){
  const labels={spread_bps:['价差','bps'],top20_imbalance_pct:['前20档失衡','%']},cells=[];
  for(const symbol of ['BTC','ETH'])for(const r of hourly(data.records.filter(r=>r.symbol===symbol),start,end))if(Number.isFinite(r[key]))cells.push({symbol,r,v:r[key]});
  const max=Math.max(.001,...cells.map(c=>Math.abs(c.v))),x=t=>65+(t-start)/(end-start)*480;
  return `<svg viewBox="0 0 570 285" role="img" aria-label="BTC和ETH ${labels[key][0]}小时热力筛选表"><rect x="65" y="58" width="480" height="140" fill="#0b1523"/>${['BTC','ETH'].map((s,i)=>xText(12,99+i*70,s)).join('')}${cells.map(c=>{const i=c.symbol==='BTC'?0:1,t=Math.abs(c.v)/max,left=Math.max(start,Math.floor(Date.parse(c.r.time)/hour)*hour),right=Math.min(end,Math.floor(Date.parse(c.r.time)/hour)*hour+hour),color=key==='top20_imbalance_pct'?`hsla(${c.v>=0?158:352} 70% 58% / ${.2+.8*t})`:`hsl(${270-t*220} 80% ${25+t*40}%)`;return `<rect x="${x(left)}" y="${68+i*70}" width="${Math.max(.2,x(right)-x(left))}" height="48" fill="${color}"><title>${c.symbol} · ${date(c.r.time)} · ${labels[key][0]} ${fmt(c.v,4)} ${labels[key][1]}</title></rect>`;}).join('')}${xText(65,230,date(new Date(start).toISOString()))}${xText(545,230,date(new Date(end).toISOString()),'end')}${xText(65,268,key==='top20_imbalance_pct'?'绿色买盘较多 · 红色卖盘较多 · 强度按绝对值':'紫色较小 → 黄色较大 · 两币种使用统一色阶')}</svg><p class="liquidity-note">${cells.length} 个有效观测 · 每小时保留最近一次；空白缺值不补零。色阶按当前区间统一缩放。</p>`;
 }
 window.LiquidityCharts={hourly,snapshotFrame,depthHeatmap,scatter,screener};
 window.renderLiquidity=function(target){
  const data=window.ORDERBOOK_DATA||{records:[],snapshots:{},states:{}};
  target.innerHTML=`<section class="liquidity-terminal"><div class="liquidity-toolbar"><div><span class="terminal-kicker">ORDERBOOK & LIQUIDITY</span><h2>订单簿与流动性工作台</h2></div><div class="controls"><select id="liquidity-symbol" aria-label="工作台币种"><option>BTC</option><option>ETH</option></select><select id="liquidity-range" aria-label="工作台时间范围"><option value="1">最近24小时</option><option value="7">最近7天</option></select><span class="terminal-tag">OKX · USDT 永续 · 小时采样</span></div></div><div id="liquidity-status"></div><div class="liquidity-grid"><section class="liquidity-widget"><div class="widget-bar"><h3>01 / 价格与买卖盘</h3><span>CHART</span></div><div id="liquidity-trend"></div></section><section class="liquidity-widget"><div class="widget-bar"><h3>02 / 币种流动性对比</h3><span>COIN COMPARISON</span></div><div id="liquidity-scatter"></div></section><section class="liquidity-widget"><div class="widget-bar"><h3>03 / 挂单深度热力图</h3><span>DEPTH HEATMAP</span></div><div id="liquidity-depth"></div></section><section class="liquidity-widget"><div class="widget-bar"><h3>04 / 流动性筛选</h3><select id="liquidity-metric" aria-label="热力筛选指标"><option value="spread_bps">买卖价差 · bps</option><option value="top20_imbalance_pct">前20档失衡 · %</option></select></div><div id="liquidity-screen"></div></section></div><details class="liquidity-method"><summary>数据范围与图表说明</summary><p>公开接口每小时采样 BTC / ETH，最多 400 档每侧。热力图保存最近 7 天、每小时最近一次的压缩深度：中间价两侧各 50 个 1 bps 价格桶，仅绘制完整覆盖的桶。历史摘要无法重建旧深度，已有最新完整快照可作为一个真实观测展示；其余从本次开始积累。</p><p>价格面板使用盘口中间价（最优买卖价均值）；失衡 =（买深度 − 卖深度）/（买深度 + 卖深度）×100%，分别比较各侧前 20 档。两侧价格跨度可能不同。散点图只比较已接入的两个币种。挂单可撤销，深度热力图展示采样时的挂单，不是强平热力图或成交资金。</p><p>所有时间均为北京时间。热力图和筛选表按来源时间归入小时格，不表示这一小时持续存在该数值。刷新网页读取云端数据，不在你的电脑持续采集。</p></details></section><details class="liquidity-details"><summary>盘口详情、累计深度与假设成交分析</summary><div id="liquidity-legacy"></div></details>`;
  const symbol=target.querySelector('#liquidity-symbol'),range=target.querySelector('#liquidity-range'),metric=target.querySelector('#liquidity-metric');
  function draw(){
   const now=Date.now(),start=now-Number(range.value)*864e5,s=symbol.value,snapshot=data.snapshots?.[s],state=data.states?.[s];
   const rows=hourly(data.records.filter(r=>r.symbol===s),start,now),prices=rows.filter(r=>Number.isFinite(r.mid)),imbalance=rows.filter(r=>Number.isFinite(r.top20_imbalance_pct));
   target.querySelector('#liquidity-status').innerHTML=`<span>${esc(s)}-USDT-SWAP</span><span>快照 ${date(snapshot?.time)}${snapshot&&now-Date.parse(snapshot.time)>90*60000?' · 已过期':''}</span><span>${state?.status==='ok'?'最近采集成功':`最近采集未成功 · ${esc(state?.code||'尚未采集')}`}</span>`;
   target.querySelector('#liquidity-trend').innerHTML=`<div class="liquidity-mini-stats"><div><small>盘口中间价 · USDT</small><strong>${fmt(snapshot?.mid)}</strong></div><div><small>最优买卖价差 · bps</small><strong>${fmt(snapshot?.spread_bps,4)}</strong></div><div><small>前20档失衡 · %</small><strong>${fmt(snapshot?.top20_imbalance_pct)}</strong></div></div><div class="liquidity-price">${window.OIChart(prices,'mid',`${s} 盘口中间价，USDT`,'USDT',[start,now],'#efc46d')}</div><div class="liquidity-imbalance">${window.OIChart(imbalance,'top20_imbalance_pct',`${s} 两侧各前20档失衡，百分比`,'%',[start,now],'#6fc4aa',{zero:true})}</div><p class="liquidity-note">上图中间价 / USDT · 下图前20档失衡 / % · ${rows.length} 个小时观测，超过2小时缺口断线。</p>`;
   target.querySelector('#liquidity-scatter').innerHTML=scatter(data,now);
   const frames=[...(data.depth_frames||[])];if(snapshot&&!frames.some(f=>f.symbol===s&&f.time===snapshot.time))frames.push(snapshotFrame(snapshot));
   target.querySelector('#liquidity-depth').innerHTML=depthHeatmap(frames,s,start,now);
   target.querySelector('#liquidity-screen').innerHTML=screener(data,metric.value,start,now);
  }
  symbol.addEventListener('change',draw);range.addEventListener('change',draw);metric.addEventListener('change',draw);draw();
  window.renderOrderbook(target.querySelector('#liquidity-legacy'));
 };
})();
