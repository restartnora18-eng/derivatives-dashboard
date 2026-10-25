'use strict';
// Shared time bounds align both panels without inventing matched timestamps.
window.OIChart = function(rows,key,title,unit,bounds,color,options={}) {
  if(!rows.length)return '<div class="empty">暂无区间数据，等待云端采集。</div>';
  const fmt=n=>Number(n).toLocaleString('zh-CN',{maximumFractionDigits:options.digits??2});
  const times=rows.map(r=>Date.parse(r.time)), vals=rows.map(r=>r[key]);
  const lo=Math.min(...vals,...(options.zero?[0]:[])),hi=Math.max(...vals,...(options.zero?[0]:[])),pad=(hi-lo)*.1||Math.max(hi*.01,1),min=lo-pad,max=hi+pad;
  const x=t=>100+(t-bounds[0])/(bounds[1]-bounds[0]||1)*825,y=v=>235-(v-min)/(max-min)*200;
  const segments=[];let segment=[];
  rows.forEach((r,i)=>{if(i && times[i]-times[i-1]>(options.maxGapMs??7200000)){segments.push(segment);segment=[];}segment.push(`${x(times[i])},${y(r[key])}`);});segments.push(segment);
  const ticks=Array.from({length:4},(_,i)=>{const v=min+(max-min)*i/3;return `<line x1="100" x2="925" y1="${y(v)}" y2="${y(v)}" stroke="currentColor" opacity=".12"/><text x="3" y="${y(v)}" fill="currentColor" font-size="11">${fmt(v)}</text>`;}).join('');
  return `<svg viewBox="0 0 950 280" role="img" aria-label="${title}" style="width:100%;color:var(--muted,#99aaa0)">${ticks}${options.zero?`<line x1="100" x2="925" y1="${y(0)}" y2="${y(0)}" stroke="currentColor" stroke-dasharray="5 4" opacity=".5"/>`:""}${segments.map(s=>`<polyline points="${s.join(' ')}" fill="none" stroke="${color}" stroke-width="2"/>`).join('')}${rows.map((r,i)=>`<circle cx="${x(times[i])}" cy="${y(r[key])}" r="3" fill="${color}"><title>${date(r.time)} · ${fmt(r[key])} ${unit}</title></circle>`).join('')}<text x="100" y="267" fill="currentColor" font-size="11">${esc(date(new Date(bounds[0]).toISOString()))}</text><text x="925" y="267" text-anchor="end" fill="currentColor" font-size="11">${esc(date(new Date(bounds[1]).toISOString()))}</text></svg>`;
};

window.renderOI = function(target) {
  const data=window.OI_DATA || {records:[],states:{}};
  target.innerHTML=`<section class="panel"><div class="panelhead"><h2>未平仓量 · OI</h2><span class="badge">OKX · USDT 永续</span></div><p>价格与 OI 共用时间轴、分别使用纵轴单位。按小时积累真实快照，保留近 30 天。OI 是未平仓合约规模，不能单独判断多空方向；美元名义金额也受价格变动影响。</p><div class="controls"><select id="oi-symbol" aria-label="OI 币种"><option>BTC</option><option>ETH</option></select><select id="oi-unit" aria-label="OI 单位"><option value="usd">美元名义金额（USD）</option><option value="coin">币数量</option><option value="contracts">合约张数</option></select><select id="oi-range" aria-label="OI 范围"><option value="7">最近 7 天</option><option value="30">最近 30 天</option></select></div><div id="oi-result"></div><p class="hint">来源：OKX public/open-interest；oi / oiCcy / oiUsd 分别对应张数、币数量、美元名义金额。只连接相邻不超过 2 小时的观测，缺口不补值。价格来源：OKX public/mark-price 的 markPx（合约标记价格，非现货或最新成交价）。两项分别采集，时间可能相差数秒，不补齐旧 OI 对应的价格。变化以本区间首末真实快照计算，不标作 24 小时变化。</p></section>`;
  function draw(){
    const symbol=target.querySelector('#oi-symbol').value, unit=target.querySelector('#oi-unit').value, days=Number(target.querySelector('#oi-range').value);
    const cutoff=Date.now()-days*864e5;
    const rows=data.records.filter(r=>r.symbol===symbol && Date.parse(r.time)>=cutoff && Number.isFinite(r[unit])).sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
    const all=data.records.filter(r=>r.symbol===symbol).sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
    const last=all.at(-1), state=data.states?.[symbol];
    const fmt=n=>Number(n).toLocaleString('zh-CN',{maximumFractionDigits:2});
    const label=unit==='usd'?'USD':unit==='coin'?symbol:'张';
    const age=last?(Date.now()-Date.parse(last.time))/36e5:Infinity;
    const prices=(window.PRICE_DATA?.records||[]).filter(r=>r.symbol===symbol && Date.parse(r.time)>=cutoff && Number.isFinite(r.price)).sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
    const extent=[...rows,...prices].map(r=>Date.parse(r.time));
    const bounds=extent.length?[Math.min(...extent),Math.max(...extent)]:[0,1];
    const chart=window.OIChart(rows,unit,`${symbol} OI 历史趋势，单位 ${label}`,label,bounds,'#c7ec96');
    const priceChart=window.OIChart(prices,'price',`${symbol} 合约标记价格，单位 USDT`,'USDT',bounds,'#a6b8f7');
    const priceState=window.PRICE_DATA?.states?.[symbol];
    const lastPrice=prices.at(-1);
    const priceInfo=`<h3>合约标记价格 · USDT</h3><p>最近价格：${lastPrice?fmt(lastPrice.price):'—'} USDT · ${date(lastPrice?.time)}${lastPrice&&Date.now()-Date.parse(lastPrice.time)>5400000?' · 已过期':''}<br>价格采集尝试：${date(window.PRICE_DATA?.attempted_at)} · ${priceState?.status==='ok'?'采集成功':`未成功 ${esc(priceState?.code||'尚未采集')}`} · ${prices.length} 个真实观测${prices.length<2?' · 积累中':''}</p>`;
    const change=rows.length>1&&rows[0][unit]>0?(rows.at(-1)[unit]/rows[0][unit]-1)*100:null;
    target.querySelector('#oi-result').innerHTML=`<p>最近采集尝试：${date(data.attempted_at)} · ${state?.status==='ok'?'采集成功':`采集未成功 ${esc(state?.code||'尚未采集')}`}</p><div class="oi-stats"><div class="stat"><span class="label">最近观测 · ${label}</span><div class="value">${last?fmt(last[unit]):'—'}</div><small>${date(last?.time)}${age>1.5?' · 已过期':''}</small></div><div class="stat"><span class="label">区间首末变化</span><div class="value">${change===null?'—':pct(change)}</div><small>${rows.length} 个真实观测${rows.length<2?' · 积累中，尚不足以形成趋势':''}</small></div></div>${priceInfo}${priceChart}<h3>未平仓量 · ${label}</h3>${chart}<p class="hint">${symbol}-USDT-SWAP · 单一交易所，不代表全市场。${state?.status!=='ok'&&last?'本次失败，保留上次观测。':''}</p>`;
  }
  target.querySelectorAll('select').forEach(el=>el.addEventListener('change',draw));draw();
};
