'use strict';
window.sortFuturesRows=function(rows,key='annualized_pct',direction=-1){
 return [...rows].sort((a,b)=>{
  const x=a[key],y=b[key],valid=v=>typeof v==='string'?v.length>0:Number.isFinite(v);
  if(!valid(x))return valid(y)?1:0;if(!valid(y))return -1;
  return direction*(typeof x==='string'?x.localeCompare(y):x-y);
 });
};
window.renderFutures=function(target){
 const data=window.FUTURES_DATA||{records:[],states:{},snapshots:{}};
 const supported=r=>r.quote_ccy==='USD'&&r.contract_type==='inverse'&&r.settle_ccy===r.symbol;
 let sortKey='annualized_pct',direction=-1;
 const columns=[['venue','交易所'],['contract','合约'],[null,'保证金'],['mark','标记价格 · USD'],[null,'持仓量 · USD'],[null,'24h 成交量 · USD'],['spread','基差 · USD'],['basis_pct','基差 %'],['annualized_pct','年化基差 %'],['days_remaining','剩余期限¹']];
 const num=(v,d=2)=>Number.isFinite(v)?v.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
 const money=v=>Number.isFinite(v)?`${v<0?'−':''}$${num(Math.abs(v))}`:'—';
 const signed=(v,percent=false)=>`<span class="${Number.isFinite(v)?v>0?'basis-positive':v<0?'basis-negative':'':''}">${percent?(Number.isFinite(v)?num(v,2)+'%':'—'):money(v)}</span>`;
 const remaining=r=>Date.parse(r.expiry)<=Date.now()?'已到期':Number.isFinite(r.days_remaining)?`${Math.floor(r.days_remaining)}天 ${Math.floor((r.days_remaining%1)*24)}小时`:'—';
 target.innerHTML=`<section class="panel futures-terminal"><div class="terminal-heading"><div><span class="terminal-kicker">FUTURES BASIS</span><h2>期货基差对比</h2></div><span class="terminal-tag">OKX · USD 币本位</span></div><div class="matrix-toolbar"><label>币种 <select id="futures-symbol" aria-label="交割合约币种"><option>BTC</option><option>ETH</option></select></label><span class="hint">默认按年化基差降序 · 点击表头切换排序</span></div><div id="futures-current"></div><details class="basis-method"><summary>计算口径与数据范围</summary><p>基差 = 合约标记价格 − 同币种 USD 指数；基差百分比 =（标记价格 ÷ 指数 − 1）× 100%；简单年化基差 = 基差百分比 × 365 ÷ 剩余天数。距到期不足 1 天不展示年化。这里使用 OKX 指数作为参考，不是截图中的跨所平均价格。</p><p>每个币种采集最近四个到期日，BTC 用 BTC 结算，ETH 用 ETH 结算。持仓量与 24 小时成交量尚未接入，因此显示 —，不使用永续合约的数据代替。绿色为正基差，红色为负基差。</p><p>¹ 剩余期限与年化均对应采集观测时刻。已到期合约从期限曲线剔除。两项价格要求在 3 分钟内、时间差不超过 120 秒；标记价与指数不能直接成交，年化未扣费用、滑点及持仓成本。</p></details><details class="basis-charts"><summary>期限结构与单一合约历史</summary><div class="controls"><select id="futures-unit" aria-label="基差口径"><option value="basis_pct">基差（%）</option><option value="annualized_pct">简单年化（%）</option></select></div><div id="futures-curve"></div><h3>单一合约历史</h3><div class="controls"><select id="futures-contract" aria-label="历史交割合约"></select><select id="futures-range" aria-label="交割历史范围"><option value="7">最近 7 天</option><option value="30">最近 30 天</option></select></div><div id="futures-history"></div><p class="hint">期限图横轴为到期日期；历史图跟踪同一个完整合约，不自动拼接换月。</p></details></section>`;
 const symbolInput=target.querySelector('#futures-symbol'),unitInput=target.querySelector('#futures-unit'),contractInput=target.querySelector('#futures-contract'),rangeInput=target.querySelector('#futures-range');
 function drawHistory(){
  const key=unitInput.value,contract=contractInput.value,cutoff=Date.now()-Number(rangeInput.value)*864e5;
  const rows=data.records.filter(r=>supported(r)&&r.contract===contract&&Date.parse(r.time)>=cutoff&&Number.isFinite(r[key])).sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
  const times=rows.map(r=>Date.parse(r.time)),bounds=times.length?[Math.min(...times),Math.max(...times)]:[0,1];
  target.querySelector('#futures-history').innerHTML=`<p>${esc(contract||'暂无合约')} · ${rows.length} 个真实观测${rows.length<2?' · 积累中':''}</p>${window.OIChart(rows,key,`${contract} ${key==='basis_pct'?'基差':'简单年化基差'}历史，单位 %`,'%',bounds,'#a6b8f7',{digits:4,zero:true})}`;
 }
 function draw(refreshContracts=false){
  const symbol=symbolInput.value,key=unitInput.value,snapshot=data.snapshots?.[symbol],state=data.states?.[symbol];
  const rows=(snapshot?.records||[]).filter(supported);
  const curve=rows.filter(r=>Date.parse(r.expiry)>Date.now()&&Number.isFinite(r[key])).sort((a,b)=>Date.parse(a.expiry)-Date.parse(b.expiry)).map(r=>({...r,time:r.expiry}));
  const times=curve.map(r=>Date.parse(r.time)),bounds=times.length?[Math.min(...times),Math.max(...times)]:[0,1];
  const errors=(state?.errors||[]).map(e=>esc(e.code)).join('、');
  target.querySelector('#futures-current').innerHTML=`<div class="basis-caption"><strong>${esc(symbol)} Futures Basis</strong><span>基差 = 标记价格 − 配对 USD 指数</span></div><p class="basis-status">快照：${date(snapshot?.captured_at)}${snapshot&&Date.now()-Date.parse(snapshot.captured_at)>5400000?' · 已过期':''}${snapshot&&snapshot.captured_at!==data.attempted_at?' · 保留上次快照':''}<br>最近尝试：${date(data.attempted_at)} · ${state?.status==='ok'?'采集成功':state?.status==='partial'?'部分失败':'采集未成功'} ${errors}</p><div class="tablewrap"><table class="futures-table"><thead><tr>${columns.map(([k,label])=>`<th ${k?`aria-sort="${sortKey===k?(direction<0?'descending':'ascending'):'none'}"`:''}>${k?`<button data-futures-sort="${k}">${label} <span>${sortKey===k?(direction<0?'▼':'▲'):'↕'}</span></button>`:label}</th>`).join('')}</tr></thead><tbody>${window.sortFuturesRows(rows,sortKey,direction).map(r=>`<tr><td>${esc((r.venue||'okx').toUpperCase())}</td><td><details><summary>${esc(r.contract)}</summary><div class="basis-source">到期：${date(r.expiry)}<br>标记：${money(r.mark)} · ${date(r.mark_time)}<br>指数：${money(r.index)} · ${date(r.index_time)}<br>指数：${esc(r.index_id)}<br>价格时间差：${num(r.skew_seconds,0)} 秒</div></details></td><td>币本位<small>${esc(r.settle_ccy)} · 反向</small></td><td>${money(r.mark)}</td><td class="basis-unavailable" title="该交割合约持仓量尚未接入">—</td><td class="basis-unavailable" title="该交割合约成交量尚未接入">—</td><td>${signed(r.spread)}</td><td>${signed(r.basis_pct,true)}</td><td>${signed(r.annualized_pct,true)}${r.near_expiry?'<small>不足 1 天</small>':''}</td><td>${remaining(r)}</td></tr>`).join('')||'<tr><td colspan="10">暂无可展示的真实合约数据。</td></tr>'}</tbody></table></div><p class="matrix-note">点击合约查看价格来源与到期日 · — 表示尚未接入或不可计算，不代表零。</p>`;
  target.querySelector('#futures-current').querySelectorAll('[data-futures-sort]').forEach(button=>button.addEventListener('click',()=>{
   const next=button.dataset.futuresSort;direction=sortKey===next?-direction:(['venue','contract'].includes(next)?1:-1);sortKey=next;draw();
  }));
  target.querySelector('#futures-curve').innerHTML=`<h3>期限结构 · ${key==='basis_pct'?'基差':'简单年化基差'}（%）</h3>${window.OIChart(curve,key,`${symbol} 按到期日排列的期限结构，单位 %`,'%',bounds,'#e1c585',{digits:4,zero:true,maxGapMs:Infinity})}`;
  if(refreshContracts){
   const contracts=[...new Set(data.records.filter(r=>supported(r)&&r.symbol===symbol).map(r=>r.contract))].sort();
   contractInput.innerHTML=contracts.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
  }
  drawHistory();
 }
 symbolInput.addEventListener('change',()=>draw(true));unitInput.addEventListener('change',()=>draw());contractInput.addEventListener('change',drawHistory);rangeInput.addEventListener('change',drawHistory);draw(true);
};
