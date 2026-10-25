'use strict';
const historySelection = {base:'BTC',venue:'all',days:7};
function mountHistory() {
  const mount=document.querySelector('#history-panel');
  if(!mount)return;
  const bundle=window.FUNDING_HISTORY || {series:{},last_attempt:null};
  const data=FundingHistoryChart.view(bundle,historySelection.base,historySelection.venue,historySelection.days);
  const attempt=bundle.last_attempt;
  const points=data.points;
  const values=points.map(p=>p.rate_percent);
  const max=values.length?Math.max(...values):null,min=values.length?Math.min(...values):null;
  mount.innerHTML=`<div class="panelhead"><div><h2>已结算资金费率历史</h2><p>逐笔结算记录 · 每次结算百分比 · 与上方估计值、演示快照分开</p></div><span class="pill">7 天 / 30 天</span></div>
    <div class="controls"><select id="history-base" aria-label="历史币种"><option value="BTC" ${historySelection.base==='BTC'?'selected':''}>BTC</option><option value="ETH" ${historySelection.base==='ETH'?'selected':''}>ETH</option></select><select id="history-venue" aria-label="历史交易所"><option value="all">全部交易所</option>${FundingModel.venueNames.map(venue=>`<option value="${venue}" ${historySelection.venue===venue?'selected':''}>${venue.toUpperCase()}</option>`).join('')}</select><select id="history-days" aria-label="历史范围"><option value="7" ${historySelection.days===7?'selected':''}>最近 7 天</option><option value="30" ${historySelection.days===30?'selected':''}>最近 30 天</option></select></div>
    <p class="hint">区间截至 ${data.end?date(new Date(data.end).toISOString()):'尚未采集'}；${points.length} 条已结算记录。网页不自动请求更新。</p>
    <div class="history-legend">${data.series.map(s=>`<span><i style="background:${FundingHistoryChart.colors[s.venue]}"></i>${s.venue.toUpperCase()} · ${s.points.length} 条</span>`).join('')}</div>
    <div class="chartwrap">${FundingHistoryChart.svg(data)}</div>
    <p class="hint">每个点对应一次结算，悬停可查看日期与数值。未推定历史结算周期或年化；不连接数据点，不补齐缺口。${data.gaps?`检测到 ${data.gaps} 段较长间隔，可能为缺口或周期变化。`:''}</p>
    ${values.length?`<div class="history-summary"><span>区间最高 <strong class="${tone(max)}">${pct(max,5)}</strong></span><span>区间最低 <strong class="${tone(min)}">${pct(min,5)}</strong></span><span>实际覆盖 ${date(points[0].settled_at)} — ${date(points[points.length-1].settled_at)}</span></div>`:''}
    <details class="history-details"><summary>历史采集状态与来源</summary><p class="hint">最近尝试：${date(attempt?.collected_at)}。下方每组数据单独保留其采集时间；历史存档与当前行情时效不同。</p><div class="venue-grid">${FundingModel.venueNames.map(venue=>{
      const state=attempt?.venues?.[venue];
      const s=bundle.series?.[`${venue}:${historySelection.base}`];
      const error=state?.errors?.filter(e=>e.base===historySelection.base).map(e=>e.code+' · '+e.message).join('；');
      const retained=s&&attempt&&s.collected_at<attempt.collected_at&&!!error;
      return `<div class="venue-state"><strong>${venue.toUpperCase()}</strong><span>${state?statusLabels[state.status]:'尚未采集'} · ${s?s.points.length:0} 条已保存</span>${error?`<small class="bad">${esc(error)}</small>`:''}${retained?'<small>本次失败，保留旧历史</small>':''}${s?`<small>该组合采集：${date(s.collected_at)}</small><small>来源：${esc(s.source_endpoint)}</small>${s.warnings.map(w=>`<small>${esc(w.message)}</small>`).join('')}`:''}</div>`;
    }).join('')}</div></details>
    <details class="history-details"><summary>最近 20 条结算明细</summary><div class="tablewrap"><table><thead><tr><th>结算时间 · 北京时间</th><th>交易所</th><th>合约</th><th>单次结算费率</th></tr></thead><tbody>${points.slice(-20).reverse().map(p=>`<tr><td>${date(p.settled_at)}</td><td>${p.venue.toUpperCase()}</td><td>${esc(p.symbol)}</td><td class="${tone(p.rate_percent)}">${pct(p.rate_percent,6)}</td></tr>`).join('')||'<tr><td colspan="4">暂无记录</td></tr>'}</tbody></table></div></details>`;
  document.querySelector('#history-base').onchange=e=>{historySelection.base=e.target.value;mountHistory();};
  document.querySelector('#history-venue').onchange=e=>{historySelection.venue=e.target.value;mountHistory();};
  document.querySelector('#history-days').onchange=e=>{historySelection.days=Number(e.target.value);mountHistory();};
}
function showContractHistory(base,venue) {
  if(!['BTC','ETH'].includes(base))return;
  historySelection.base=base;historySelection.venue=venue;
  mountHistory();
  document.querySelector('#history-panel')?.scrollIntoView({behavior:'smooth',block:'start'});
}
