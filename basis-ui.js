'use strict';
window.renderBasis=function(target){
 const data=window.BASIS_DATA||{records:[],states:{}};
 target.innerHTML=`<div id="futures-panel"></div><details class="basis-perpetual"><summary>永续溢价 · USDT 独立口径</summary><section class="panel"><div class="panelhead"><h2>永续溢价 · 标记价格相对指数</h2><span class="badge">OKX · USDT 永续</span></div><p>溢价 =（标记价格 ÷ USDT 现货指数 − 1）× 100%。正值表示高于指数，负值表示低于指数。这里不计算交割合约到期年化基差，也不等同于资金费率。</p><div class="controls"><select id="basis-symbol" aria-label="溢价币种"><option>BTC</option><option>ETH</option></select><select id="basis-range" aria-label="溢价范围"><option value="7">最近 7 天</option><option value="30">最近 30 天</option></select></div><div id="basis-result"></div><p class="hint">复用本次已采集的合约标记价格，与同币种、同为 USDT 计价的指数配对。两项价格均要求在 3 分钟内，时间差不超过 120 秒；它们不是同一瞬间的可成交报价。图表每小时积累，超过 2 小时缺口断线，保留近 30 天。交割合约期限结构见上方独立面板。</p></section></details>`;
 function draw(){
  const symbol=target.querySelector('#basis-symbol').value,days=Number(target.querySelector('#basis-range').value),cutoff=Date.now()-days*864e5;
  const all=data.records.filter(r=>r.symbol===symbol).sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
  const rows=all.filter(r=>Date.parse(r.time)>=cutoff&&Number.isFinite(r.premium_pct));
  const last=all.at(-1),state=data.states?.[symbol],fmt=v=>Number(v).toLocaleString('zh-CN',{maximumFractionDigits:4});
  const times=rows.map(r=>Date.parse(r.time)),bounds=times.length?[Math.min(...times),Math.max(...times)]:[0,1];
  let chart=window.OIChart(rows,'premium_pct',`${symbol} 永续溢价历史，单位 %`,'%',bounds,'#e1c585',{digits:4,zero:true});
  target.querySelector('#basis-result').innerHTML=`<p>最近尝试：${date(data.attempted_at)} · ${state?.status==='ok'?'采集成功':`采集未成功 ${esc(state?.code||'尚未采集')}`}</p><div class="oi-stats"><div class="stat"><span class="label">最近永续溢价</span><div class="value">${last?pct(last.premium_pct,4):'—'}</div><small>${date(last?.time)}${last&&Date.now()-Date.parse(last.time)>5400000?' · 已过期':''}</small></div><div class="stat"><span class="label">标记价格 − 指数 · USDT</span><div class="value">${last?fmt(last.spread):'—'}</div><small>${rows.length} 个区间观测${rows.length<2?' · 积累中':''}</small></div></div>${chart}${last?`<details><summary>价格来源与配对时间</summary><p>${symbol}-USDT-SWAP 标记价格：${fmt(last.mark)} USDT<br>来源时间：${date(last.mark_time)}<br>${symbol}-USDT 指数：${fmt(last.index)} USDT<br>来源时间：${date(last.index_time)}<br>时间差：${fmt(last.skew_seconds)} 秒<br>来源：OKX public/mark-price 与 market/index-tickers</p></details>`:''}${state?.status!=='ok'&&last?'<p class="hint">本次失败，保留上次观测。</p>':''}`;
 }
 target.querySelectorAll('select').forEach(e=>e.addEventListener('change',draw));draw();
 if(window.renderFutures)window.renderFutures(target.querySelector('#futures-panel'));
};
