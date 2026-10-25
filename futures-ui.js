'use strict';
window.renderFutures=function(target){
 const data=window.FUTURES_DATA||{records:[],states:{},snapshots:{}};
 target.innerHTML=`<section class="panel"><div class="panelhead"><h2>交割合约基差与期限结构</h2><span class="badge">OKX · USDT 线性</span></div><p>每个币种最多采集最近四个到期日。基差 =（合约标记价格 ÷ 同币种 USDT 指数 − 1）× 100%；简单年化基差 = 基差 × 365 ÷ 剩余天数，剩余天数按观测时刻精确计算。距到期不足 1 天时不展示年化。</p><div class="controls"><select id="futures-symbol" aria-label="交割合约币种"><option>BTC</option><option>ETH</option></select><select id="futures-unit" aria-label="基差口径"><option value="basis_pct">基差（%）</option><option value="annualized_pct">简单年化（%）</option></select></div><div id="futures-current"></div><h3>单一合约历史</h3><div class="controls"><select id="futures-contract" aria-label="历史交割合约"></select><select id="futures-range" aria-label="交割历史范围"><option value="7">最近 7 天</option><option value="30">最近 30 天</option></select></div><div id="futures-history"></div><p class="hint">期限图的横轴是到期日期，不是历史日期；历史图始终跟踪同一个完整合约，不自动拼接换月。两项来源价格要求在 3 分钟内、时间差不超过 120 秒。标记价与指数不能直接成交，简单年化未扣除费用、滑点及持仓成本，不代表实际收益。</p></section>`;
 const symbolInput=target.querySelector('#futures-symbol'),unitInput=target.querySelector('#futures-unit'),contractInput=target.querySelector('#futures-contract'),rangeInput=target.querySelector('#futures-range');
 function drawHistory(){
  const key=unitInput.value,contract=contractInput.value,cutoff=Date.now()-Number(rangeInput.value)*864e5;
  const rows=data.records.filter(r=>r.contract===contract&&Date.parse(r.time)>=cutoff&&Number.isFinite(r[key])).sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
  const times=rows.map(r=>Date.parse(r.time)),bounds=times.length?[Math.min(...times),Math.max(...times)]:[0,1];
  target.querySelector('#futures-history').innerHTML=`<p>${esc(contract||'暂无合约')} · ${rows.length} 个真实观测${rows.length<2?' · 积累中':''}</p>${window.OIChart(rows,key,`${contract} ${key==='basis_pct'?'基差':'简单年化基差'}历史，单位 %`,'%',bounds,'#a6b8f7',{digits:4,zero:true})}`;
 }
 function draw(refreshContracts=false){
  const symbol=symbolInput.value,key=unitInput.value,snapshot=data.snapshots?.[symbol],state=data.states?.[symbol];
  const rows=(snapshot?.records||[]).slice().sort((a,b)=>Date.parse(a.expiry)-Date.parse(b.expiry));
  const fresh=rows.filter(r=>Date.parse(r.expiry)>Date.now());
  const curve=fresh.filter(r=>Number.isFinite(r[key])).map(r=>({...r,time:r.expiry}));
  const times=curve.map(r=>Date.parse(r.time)),bounds=times.length?[Math.min(...times),Math.max(...times)]:[0,1];
  const errors=(state?.errors||[]).map(e=>esc(e.code)).join('、');
  target.querySelector('#futures-current').innerHTML=`<p>最近尝试：${date(data.attempted_at)} · ${state?.status==='ok'?'采集成功':state?.status==='partial'?'部分失败':'采集未成功'} ${errors}<br>曲线快照：${date(snapshot?.captured_at)}${snapshot&&Date.now()-Date.parse(snapshot.captured_at)>5400000?' · 已过期':''}${snapshot&&snapshot.captured_at!==data.attempted_at?' · 保留上次快照':''}</p><h3>期限结构 · ${key==='basis_pct'?'基差':'简单年化基差'}（%）</h3>${window.OIChart(curve,key,`${symbol} 按到期日排列的期限结构，单位 %`,'%',bounds,'#e1c585',{digits:4,zero:true,maxGapMs:Infinity})}<div class="tablewrap"><table><thead><tr><th>合约 / 到期时间</th><th>剩余天数¹</th><th>基差</th><th>简单年化</th><th>价格与时间</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.contract)}<small class="contract">${date(r.expiry)}</small></td><td>${r.days_remaining.toFixed(2)}${Date.parse(r.expiry)<=Date.now()?' · 已到期':r.near_expiry?' · 临近到期':''}</td><td>${pct(r.basis_pct,4)}</td><td>${Number.isFinite(r.annualized_pct)?pct(r.annualized_pct,2):'—（不足 1 天）'}</td><td><details><summary>查看来源</summary><p>标记：${r.mark} USDT · ${date(r.mark_time)}<br>指数：${r.index} USDT · ${date(r.index_time)}<br>时间差 ${r.skew_seconds} 秒</p></details></td></tr>`).join('')||'<tr><td colspan="5">暂无可展示的真实合约数据。</td></tr>'}</tbody></table></div><p class="hint">¹ 剩余天数与年化均对应采集观测时刻。已到期合约从期限曲线剔除；保留的旧快照不代表当前报价。</p>`;
  if(refreshContracts){
   const contracts=[...new Set(data.records.filter(r=>r.symbol===symbol).map(r=>r.contract))].sort();
   contractInput.innerHTML=contracts.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
  }
  drawHistory();
 }
 symbolInput.addEventListener('change',()=>draw(true));unitInput.addEventListener('change',()=>draw());contractInput.addEventListener('change',drawHistory);rangeInput.addEventListener('change',drawHistory);draw(true);
};
