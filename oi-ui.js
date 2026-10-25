'use strict';
window.renderOI = function(target) {
  const data=window.OI_DATA || {records:[],states:{}};
  target.innerHTML=`<section class="panel"><div class="panelhead"><h2>未平仓量 · OI</h2><span class="badge">OKX · USDT 永续</span></div><p>按小时积累真实快照，保留近 30 天。OI 是未平仓合约规模，不能单独判断多空方向；美元名义金额也受价格变动影响。</p><div class="controls"><select id="oi-symbol" aria-label="OI 币种"><option>BTC</option><option>ETH</option></select><select id="oi-unit" aria-label="OI 单位"><option value="usd">美元名义金额（USD）</option><option value="coin">币数量</option><option value="contracts">合约张数</option></select><select id="oi-range" aria-label="OI 范围"><option value="7">最近 7 天</option><option value="30">最近 30 天</option></select></div><div id="oi-result"></div><p class="hint">来源：OKX public/open-interest；oi / oiCcy / oiUsd 分别对应张数、币数量、美元名义金额。只连接相邻不超过 2 小时的观测，缺口不补值。变化以本区间首末真实快照计算，不标作 24 小时变化。</p></section>`;
  function draw(){
    const symbol=target.querySelector('#oi-symbol').value, unit=target.querySelector('#oi-unit').value, days=Number(target.querySelector('#oi-range').value);
    const cutoff=Date.now()-days*864e5;
    const rows=data.records.filter(r=>r.symbol===symbol && Date.parse(r.time)>=cutoff && Number.isFinite(r[unit])).sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
    const all=data.records.filter(r=>r.symbol===symbol).sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
    const last=all.at(-1), state=data.states?.[symbol];
    const fmt=n=>Number(n).toLocaleString('zh-CN',{maximumFractionDigits:2});
    const label=unit==='usd'?'USD':unit==='coin'?symbol:'张';
    const age=last?(Date.now()-Date.parse(last.time))/36e5:Infinity;
    let chart='<div class="empty">暂无区间数据，等待云端采集。</div>';
    if(rows.length){
      const times=rows.map(r=>Date.parse(r.time)), vals=rows.map(r=>r[unit]);
      const lo=Math.min(...vals), hi=Math.max(...vals), pad=(hi-lo)*.1||Math.max(hi*.01,1), min=lo-pad,max=hi+pad;
      const x=t=>75+(t-times[0])/(times.at(-1)-times[0]||1)*850, y=v=>235-(v-min)/(max-min)*200;
      const segments=[];let segment=[];
      rows.forEach((r,i)=>{if(i && times[i]-times[i-1]>7200000){segments.push(segment);segment=[];}segment.push(`${x(times[i])},${y(r[unit])}`);});segments.push(segment);
      const ticks=Array.from({length:4},(_,i)=>{const v=min+(max-min)*i/3;return `<line x1="75" x2="925" y1="${y(v)}" y2="${y(v)}" stroke="currentColor" opacity=".12"/><text x="3" y="${y(v)}" fill="currentColor" font-size="11">${fmt(v)}</text>`;}).join('');
      chart=`<svg viewBox="0 0 950 280" role="img" aria-label="${symbol} OI 历史趋势，单位 ${label}" style="width:100%;color:var(--muted,#99aaa0)">${ticks}${segments.map(s=>`<polyline points="${s.join(' ')}" fill="none" stroke="#c7ec96" stroke-width="2"/>`).join('')}${rows.map((r,i)=>`<circle cx="${x(times[i])}" cy="${y(r[unit])}" r="3" fill="#c7ec96"><title>${date(r.time)} · ${fmt(r[unit])} ${label}</title></circle>`).join('')}<text x="75" y="267" fill="currentColor" font-size="11">${esc(date(rows[0].time))}</text><text x="925" y="267" text-anchor="end" fill="currentColor" font-size="11">${esc(date(rows.at(-1).time))}</text></svg>`;
    }
    const change=rows.length>1&&rows[0][unit]>0?(rows.at(-1)[unit]/rows[0][unit]-1)*100:null;
    target.querySelector('#oi-result').innerHTML=`<p>最近采集尝试：${date(data.attempted_at)} · ${state?.status==='ok'?'采集成功':`采集未成功 ${esc(state?.code||'尚未采集')}`}</p><div class="oi-stats"><div class="stat"><span class="label">最近观测 · ${label}</span><div class="value">${last?fmt(last[unit]):'—'}</div><small>${date(last?.time)}${age>1.5?' · 已过期':''}</small></div><div class="stat"><span class="label">区间首末变化</span><div class="value">${change===null?'—':pct(change)}</div><small>${rows.length} 个真实观测${rows.length<2?' · 积累中，尚不足以形成趋势':''}</small></div></div>${chart}<p class="hint">${symbol}-USDT-SWAP · 单一交易所，不代表全市场。${state?.status!=='ok'&&last?'本次失败，保留上次观测。':''}</p>`;
  }
  target.querySelectorAll('select').forEach(el=>el.addEventListener('change',draw));draw();
};
