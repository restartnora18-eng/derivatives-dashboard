'use strict';
window.simulateBookFill=function(snapshot,quantity,side){
 if(!snapshot||!Number.isFinite(quantity)||quantity<=0||quantity>1e9||!['buy','sell'].includes(side))return {error:'请输入大于0且不超过10亿的有限数量。'};
 const levels=snapshot[side==='buy'?'asks':'bids'];
 if(!Array.isArray(levels)||!levels.length||!Number.isFinite(snapshot.mid)||snapshot.mid<=0)return {error:'缺少有效盘口。'};
 let remaining=quantity,filled=0,notional=0,worst=null,used=0;const steps=[];
 for(const level of levels){
  if(!Number.isFinite(level.price)||level.price<=0||!Number.isFinite(level.coin)||level.coin<=0)return {error:'盘口档位或币数量无效，停止模拟。'};
  if(remaining<=quantity*1e-12)break;
  const take=Math.min(remaining,level.coin);remaining-=take;filled+=take;notional+=take*level.price;worst=level.price;used++;
  steps.push({quantity:filled,price:notional/filled,worst});
 }
 const complete=remaining<=quantity*1e-12;
 const average=filled>0?notional/filled:null,best=levels[0].price;
 return {side,requested:quantity,filled,unfilled:complete?0:Math.max(0,remaining),complete,notional,average,worst,levels:used,fill_pct:filled/quantity*100,
  impact_mid_bps:average===null?null:(side==='buy'?average/snapshot.mid-1:1-average/snapshot.mid)*10000,
  impact_best_bps:average===null?null:(side==='buy'?average/best-1:1-average/best)*10000,steps};
};
window.mountBookSimulator=function(target,snapshot){
 if(!snapshot){target.innerHTML='';return;}
 const fmt=(n,d=6)=>Number.isFinite(n)?(n!==0&&Math.abs(n)<1e-6?n.toExponential(3):n.toLocaleString('zh-CN',{maximumFractionDigits:d})):'—';
 target.innerHTML=`<div class="panelhead"><h3>假设成交 · 盘口滑点模拟</h3><span class="pill">离线计算 · 不下单</span></div><p class="hint">使用 ${esc(snapshot.contract)} 在 ${date(snapshot.time)} 保存的盘口。${Date.now()-Date.parse(snapshot.time)>5400000?'该快照已过期。':''}不是当前可执行报价。</p><div class="controls"><label for="sim-quantity">假设数量（${esc(snapshot.symbol)}）</label><input id="sim-quantity" type="number" min="0" max="1000000000" step="any" placeholder="输入币数量" aria-label="假设成交币数量"></div><div id="sim-result" aria-live="polite"></div><p class="hint">逐档消耗卖盘模拟买入、消耗买盘模拟卖出，可部分取用最后一档。相对中间价的冲击包含半边价差；相对最优同侧报价的冲击只衡量吃单深度。未计手续费、资金费、盘口变化、隐藏流动性及最小下单单位；不保证真实成交或收益。盘口不足只报告已覆盖部分，不外推剩余部分价格。</p>`;
 const input=target.querySelector('#sim-quantity'),output=target.querySelector('#sim-result');
 function draw(){const q=Number(input.value);if(input.value.trim()===''){output.innerHTML='<p class="hint">输入假设数量后，同时比较买入与卖出。</p>';return;}
 const rs=['buy','sell'].map(side=>window.simulateBookFill(snapshot,q,side));
 if(rs.some(r=>r.error)){output.innerHTML=`<p class="bad">${esc(rs.find(r=>r.error).error)}</p>`;return;}
 const maxQ=Math.max(...rs.map(r=>r.filled)),maxImpact=Math.max(1,...rs.map(r=>r.impact_mid_bps));
 const x=v=>80+v/(maxQ||1)*840,y=v=>235-v/maxImpact*205;
 const chart=`<svg viewBox="0 0 950 280" style="width:100%;color:var(--muted)" role="img" aria-label="假设成交数量与平均价格冲击，横轴币数量，纵轴bps"><text x="2" y="30" fill="currentColor" font-size="11">${fmt(maxImpact,3)} bps</text><text x="2" y="235" fill="currentColor" font-size="11">0</text>${rs.map(r=>{const points=r.steps.map(p=>`${x(p.quantity)},${y((r.side==='buy'?p.price/snapshot.mid-1:1-p.price/snapshot.mid)*10000)}`);return `<polyline points="${points.join(' ')}" fill="none" stroke="${r.side==='buy'?'#eea99a':'#a6b8f7'}" stroke-width="2"/>${r.steps.map(p=>`<circle cx="${x(p.quantity)}" cy="${y((r.side==='buy'?p.price/snapshot.mid-1:1-p.price/snapshot.mid)*10000)}" r="2" fill="${r.side==='buy'?'#eea99a':'#a6b8f7'}"><title>${fmt(p.quantity)} ${esc(snapshot.symbol)} · 均价 ${fmt(p.price,4)} USDT</title></circle>`).join('')}`;}).join('')}<text x="80" y="267" fill="currentColor" font-size="11">0 ${esc(snapshot.symbol)}</text><text x="920" y="267" text-anchor="end" fill="currentColor" font-size="11">${fmt(maxQ)} ${esc(snapshot.symbol)}</text></svg>`;
 output.innerHTML=`<div class="tablewrap"><table><thead><tr><th>假设方向</th><th>盘口覆盖</th><th>覆盖均价（USDT）</th><th>覆盖部分名义额（USDT）</th><th>相对中间价冲击</th><th>相对最优报价冲击</th><th>最后消耗档位</th></tr></thead><tbody>${rs.map(r=>`<tr><td>${r.side==='buy'?'买入 · 红线':'卖出 · 蓝线'}</td><td>${fmt(r.filled)} / ${fmt(q)} ${esc(snapshot.symbol)}<small class="contract">${r.complete?'覆盖全部假设数量':`深度不足 · 未覆盖 ${fmt(r.unfilled)} ${esc(snapshot.symbol)}`}</small></td><td>${fmt(r.average,4)}${r.complete?'':'（仅已覆盖部分）'}</td><td>${fmt(r.notional,2)}</td><td>${fmt(r.impact_mid_bps,4)} bps</td><td>${fmt(r.impact_best_bps,4)} bps</td><td>${fmt(r.worst,4)} USDT · ${r.levels} 档</td></tr>`).join('')}</tbody></table></div><h4>平均冲击随可覆盖数量变化（逐档端点连线）</h4>${chart}`;
 }
 input.addEventListener('input',draw);draw();
};
