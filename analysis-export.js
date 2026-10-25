'use strict';
window.AnalysisCSVCell=function(value){
 if(value===null||value===undefined)return '';
 let text=String(value);
 // Guard text cells against spreadsheet formulas; genuine numeric negatives remain numbers.
 if(typeof value!=='number'&&/^\s*[=+@-]/.test(text))text="'"+text;
 return '"'+text.replace(/"/g,'""')+'"';
};
window.AnalysisCSV=function(symbol,days,now=Date.now()){
 const start=now-days*864e5,view=window.SummarySeries(symbol,30,now),rankIndices=new Set([1,3,5,6,7,8]),items=view.series.map((s,i)=>({...s,rankable:rankIndices.has(i)}));
 items.push({title:'期权 Put/Call OI 比 · 当时全部在市合约',key:'pcr',unit:'比值',rankable:true,rows:(window.OPTION_POSITIONS_DATA?.records||[]).filter(r=>r.symbol===symbol)});
 const rows=[];
 for(const s of items){const source=s.rankable?window.DailyPercentileSeries(s.rows,s.key,now):s.rows;
  for(const r of source){const t=Date.parse(r.time);if(t<start||t>now||!Number.isFinite(t)||!Number.isFinite(r[s.key]))continue;
   rows.push({t,cells:[symbol,s.title,s.key,r.time,r[s.key],s.unit,s.rankable?r.reference_days:null,s.rankable?r.rank:null]});
  }
 }
 rows.sort((a,b)=>a.t-b.t||a.cells[1].localeCompare(b.cells[1]));
 const header=['symbol','metric_and_instrument_context','metric_key','source_time_utc','raw_value','unit','prior_reference_days','percentile_0_100'];
 return '\uFEFF'+[header,...rows.map(r=>r.cells)].map(row=>row.map(window.AnalysisCSVCell).join(',')).join('\r\n')+'\r\n';
};
window.DownloadAnalysisCSV=function(symbol,days){
 const csv=window.AnalysisCSV(symbol,days),url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),link=document.createElement('a');
 link.href=url;link.download=`derivatives-${symbol}-${days}d-${new Date().toISOString().slice(0,10)}.csv`;link.hidden=true;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
