'use strict';
window.SummarySeries=function(symbol,days,now=Date.now()){
 const start=now-days*864e5,filter=rows=>(rows||[]).filter(r=>r.symbol===symbol&&Date.parse(r.time)>=start&&Date.parse(r.time)<=now).sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
 const price=filter(window.PRICE_DATA?.records),oi=filter(window.OI_DATA?.records),basis=filter(window.BASIS_DATA?.records);
 const fundingSource=window.FUNDING_HISTORY?.series?.[`okx:${symbol}`];
 const funding=(fundingSource?.points||[]).filter(p=>Date.parse(p.settled_at)>=start&&Date.parse(p.settled_at)<=now).map(p=>({time:p.settled_at,value:p.rate_percent}));
 const snap=window.FUTURES_DATA?.snapshots?.[symbol];
 const candidates=(snap?.records||[]).filter(r=>r.quote_ccy==='USD'&&r.contract_type==='inverse'&&r.settle_ccy===symbol&&Date.parse(r.expiry)>now).sort((a,b)=>Date.parse(a.expiry)-Date.parse(b.expiry));
 const chosen=candidates.find(r=>Date.parse(r.expiry)-now>=7*864e5)||candidates[0];
 const future=filter(window.FUTURES_DATA?.records).filter(r=>r.contract===chosen?.contract&&r.quote_ccy==='USD'&&r.contract_type==='inverse');
 const optionCandidates=(window.OPTIONS_DATA?.snapshots?.[symbol]?.records||[]).filter(r=>Date.parse(r.expiry)>now);
 const option=optionCandidates.length?optionCandidates.reduce((a,b)=>Math.abs(Date.parse(a.expiry)-now-30*864e5)<Math.abs(Date.parse(b.expiry)-now-30*864e5)?a:b):null;
 const optionRows=filter(window.OPTIONS_DATA?.records).filter(r=>r.expiry===option?.expiry);
 return {bounds:[start,now],series:[
  {title:'合约标记价格',rows:price,key:'price',unit:'USDT',color:'#a6b8f7',attempt:window.PRICE_DATA?.attempted_at,state:window.PRICE_DATA?.states?.[symbol]?.status},
  {title:'未平仓量 · 币数量',rows:oi,key:'coin',unit:symbol,color:'#c7ec96',attempt:window.OI_DATA?.attempted_at,state:window.OI_DATA?.states?.[symbol]?.status},
  {title:'已结算资金费率 · 每次结算',rows:funding,key:'value',unit:'%',color:'#e7a594',digits:5,zero:true,pointsOnly:true,attempt:fundingSource?.collected_at,historical:true},
  {title:'永续溢价 · USDT 指数口径',rows:basis,key:'premium_pct',unit:'%',color:'#e1c585',digits:4,zero:true,attempt:window.BASIS_DATA?.attempted_at,state:window.BASIS_DATA?.states?.[symbol]?.status},
  {title:`交割基差 · ${chosen?.contract||'尚无合约'}`,rows:future,key:'basis_pct',unit:'%',color:'#a6d7d7',digits:4,zero:true,attempt:window.FUTURES_DATA?.attempted_at,state:window.FUTURES_DATA?.states?.[symbol]?.status},
  {title:`ATM IV 近似 · ${option?date(option.expiry):'尚无期限'} 到期`,rows:optionRows,key:'atm_iv_pct',unit:'%',color:'#b6a6ef',digits:3,attempt:window.OPTIONS_DATA?.attempted_at,state:window.OPTIONS_DATA?.states?.[symbol]?.status},
  {title:`25Δ RR 近似 · ${option?date(option.expiry):'尚无期限'} 到期`,rows:optionRows,key:'rr25_proxy_pp',unit:'百分点',color:'#d8a6c8',digits:3,zero:true,attempt:window.OPTIONS_DATA?.attempted_at,state:window.OPTIONS_DATA?.states?.[symbol]?.status}
 ,{title:'盘口买卖价差 · 400档快照',rows:filter(window.ORDERBOOK_DATA?.records),key:'spread_bps',unit:'bps',color:'#a6d7d7',digits:4,attempt:window.ORDERBOOK_DATA?.attempted_at,state:window.ORDERBOOK_DATA?.states?.[symbol]?.status}
 ,{title:'买卖各前20档深度失衡',rows:filter(window.ORDERBOOK_DATA?.records),key:'top20_imbalance_pct',unit:'%',color:'#c7ec96',digits:2,zero:true,attempt:window.ORDERBOOK_DATA?.attempted_at,state:window.ORDERBOOK_DATA?.states?.[symbol]?.status}
 ]};
};
window.renderSummary=function(target){
 target.innerHTML=`<div class="panelhead"><div><h2>市场总览 · 多指标对照</h2><p>OKX · 真实观测 · 共用时间轴</p></div><span class="badge">综合观察框架</span></div><p class="hint">这里始终展示真实采集数据，与下方历史演示数据集独立。各指标保留原单位，不合成分数。期权为实际到期日的 IV / RR 近似值；盘口为小时快照，强平仍待接入。</p><div class="controls"><select id="summary-symbol" aria-label="总览币种"><option>BTC</option><option>ETH</option></select><select id="summary-days" aria-label="总览时间范围"><option value="1">最近 24 小时</option><option value="7">最近 7 天</option><option value="30">最近 30 天</option></select></div><div id="summary-charts"></div><p class="hint">所有图使用相同起止时间；纵轴各自缩放，斜率不能直接比较。小时采样超过 2 小时缺口断线；已结算资金费率仅画真实结算点。交割图跟踪标题中的单一 USD 币本位合约，不拼接换月，也不与 USDT 永续混为同一种合约。</p>`;
 function draw(){
  const symbol=target.querySelector('#summary-symbol').value,days=Number(target.querySelector('#summary-days').value),view=window.SummarySeries(symbol,days);
  target.querySelector('#summary-charts').innerHTML=view.series.map(s=>{
   const rows=s.rows.filter(r=>Number.isFinite(r[s.key])),last=rows.at(-1),age=last?Date.now()-Date.parse(last.time):Infinity;
   const value=last?Number(last[s.key]).toLocaleString('zh-CN',{maximumFractionDigits:s.digits??2}):'—';
   const status=s.historical?'真实结算历史':s.state==='ok'?'最近采集成功':s.state==='partial'?'部分失败':'采集未成功';
   return `<article class="summary-chart"><div class="panelhead"><h3>${esc(s.title)}</h3><strong style="color:${s.color}">${value} ${esc(s.unit)}</strong></div><p class="hint">${status} · ${rows.length} 个区间观测${rows.length<2?' · 积累中':''}<br>数据时间：${date(last?.time)}${!s.historical&&age>5400000?' · 暂无新鲜观测':''} · 采集时间：${date(s.attempt)}</p>${window.OIChart(rows,s.key,`${symbol} ${s.title}，单位 ${s.unit}`,s.unit,view.bounds,s.color,{digits:s.digits??2,zero:s.zero,maxGapMs:s.pointsOnly?0:7200000})}</article>`;
  }).join('');
 }
 target.querySelectorAll('select').forEach(e=>e.addEventListener('change',draw));draw();
};
