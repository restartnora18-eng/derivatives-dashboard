(function (root) {
  'use strict';
  const colors = {binance:'#e4c875',bybit:'#eda886',okx:'#c0ed98',bitget:'#a6b6f5'};
  const escape = text => String(text).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const percent = n => (n>=0?'+':'')+n.toFixed(5)+'%';
  const date = t => new Date(t).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
  function view(bundle, base='BTC', venue='all', days=7) {
    const all = Object.values(bundle?.series || {}).filter(s=>s.base===base&&(venue==='all'||s.venue===venue));
    const end = Date.parse(bundle?.last_attempt?.requested_end) || Math.max(0,...all.map(s=>Date.parse(s.requested_end)||0));
    const start = end-days*86400000;
    const series = all.map(s=>{
      const points = s.points.filter(p=>Number.isFinite(p.rate_percent)&&Date.parse(p.settled_at)>=start&&Date.parse(p.settled_at)<=end)
        .map(p=>({...p,time:Date.parse(p.settled_at)})).sort((a,b)=>a.time-b.time);
      const unique = [...new Map(points.map(p=>[p.time,p])).values()];
      const deltas = unique.slice(1).map((p,i)=>p.time-unique[i].time).filter(n=>n>0).sort((a,b)=>a-b);
      const typical = deltas.length ? deltas[Math.floor(deltas.length/2)] : null;
      const gaps = typical ? unique.slice(1).filter((p,i)=>p.time-unique[i].time>typical*1.5).length : 0;
      return {...s,points:unique,gaps,typical};
    });
    const points = series.flatMap(s=>s.points.map(p=>({...p,venue:s.venue,symbol:s.symbol}))).sort((a,b)=>a.time-b.time);
    return {base,venue,days,start,end,series,points,gaps:series.reduce((n,s)=>n+s.gaps,0)};
  }
  function svg(data) {
    if (!data.points.length) return '<div class="empty">所选区间暂无可验证的已结算记录。可切换交易所或查看采集状态。</div>';
    const width=960,height=320,left=90,right=24,top=24,bottom=46;
    const values=data.points.map(p=>p.rate_percent);
    let min=Math.min(0,...values),max=Math.max(0,...values);
    const pad=(max-min)*0.14 || 0.001;
    min-=pad;max+=pad;
    const x=t=>left+(t-data.start)/Math.max(1,data.end-data.start)*(width-left-right);
    const y=v=>top+(max-v)/(max-min)*(height-top-bottom);
    const fixed=v=>v.toFixed(2);
    const ticks=Array.from({length:5},(_,i)=>min+(max-min)*i/4).map(value=>
      `<line x1="${left}" x2="${width-right}" y1="${fixed(y(value))}" y2="${fixed(y(value))}" stroke="#2b3531"/><text x="${left-12}" y="${fixed(y(value)+4)}" text-anchor="end" fill="#94a39b" font-size="11">${value.toFixed(4)}%</text>`).join('');
    const dates=Array.from({length:4},(_,i)=>data.start+(data.end-data.start)*i/3).map(t=>
      `<text x="${fixed(x(t))}" y="${height-15}" text-anchor="${t===data.start?'start':t===data.end?'end':'middle'}" fill="#94a39b" font-size="11">${escape(new Date(t).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit'}))}</text>`).join('');
    const marks=data.series.map(series=>series.points.map(point=>{
      const label=`${series.venue.toUpperCase()} ${series.base} · ${date(point.time)} 北京时间 · ${percent(point.rate_percent)}`;
      return `<line x1="${fixed(x(point.time))}" x2="${fixed(x(point.time))}" y1="${fixed(y(0))}" y2="${fixed(y(point.rate_percent))}" stroke="${colors[series.venue]}" opacity=".23"/><circle cx="${fixed(x(point.time))}" cy="${fixed(y(point.rate_percent))}" r="3.4" fill="${colors[series.venue]}" tabindex="0" aria-label="${escape(label)}"><title>${escape(label)}</title></circle>`;
    }).join('')).join('');
    return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${data.base} 最近${data.days}天已结算资金费率，每个点代表一次真实结算记录"><title>已结算资金费率，单位为每次结算百分比</title>${ticks}<line x1="${left}" x2="${width-right}" y1="${fixed(y(0))}" y2="${fixed(y(0))}" stroke="#708578" stroke-dasharray="4 4"/>${dates}${marks}</svg>`;
  }
  const api={view,svg,colors};
  if(typeof module!=='undefined'&&module.exports) module.exports=api;
  else root.FundingHistoryChart=api;
})(typeof globalThis==='undefined'?this:globalThis);
