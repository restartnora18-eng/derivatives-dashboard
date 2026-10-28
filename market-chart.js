/* Kimra market chart. Prices come only from Binance USD-M public trade candles. */
'use strict';
(function(root){
 const intervals={'5m':300,'15m':900,'1h':3600,'4h':14400,'1d':86400};
 function normalize(raw,interval,now=Date.now()){
  if(!intervals[interval]||!Array.isArray(raw)||!raw.length)throw Error('行情格式无效');
  const step=intervals[interval],seen=new Set();
  const num=v=>{if(v===null||v===''||typeof v==='boolean'||!Number.isFinite(Number(v)))throw Error('行情数值无效');return Number(v);};
  return raw.map(row=>{
   if(!Array.isArray(row)||row.length<7)throw Error('K 线字段不完整');
   const [ms,open,high,low,close,volume,end]=row.slice(0,7).map(num),time=ms/1000;
   if(!Number.isSafeInteger(ms)||ms<=0||time%step||ms>now||end!==ms+step*1000-1||seen.has(time))throw Error('K 线时间无效或重复');
   if(Math.min(open,high,low,close)<=0||low>Math.min(open,close)||high<Math.max(open,close)||volume<0)throw Error('K 线价格或成交量无效');
   seen.add(time);return {time,open,high,low,close,volume,closed:end<now};
  }).sort((a,b)=>a.time-b.time);
 }
 function averages(rows,step){let sum=0,run=[];return rows.flatMap((b,i)=>{if(i&&b.time-rows[i-1].time!==step){sum=0;run=[];}run.push(b.close);sum+=b.close;if(run.length>20)sum-=run.shift();return run.length===20?[{time:b.time,value:sum/20}]:[{time:b.time}];});}
 function padded(rows,step){const result=[];rows.forEach((b,i)=>{if(i&&b.time-rows[i-1].time>step)result.push({time:rows[i-1].time+step});result.push(b);});return result;}
 if(typeof module!=='undefined'&&module.exports){module.exports={normalize,averages,padded,intervals};return;}
 const clock=t=>new Date(t*1000).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
 root.renderMarketChart=function(target){
  target.innerHTML=`<section class="panel market-chart-panel"><div class="panelhead"><div><h2>永续合约行情</h2><p>Binance USDⓈ-M · 成交价 K 线 · 北京时间 UTC+8</p></div><span class="pill">Lightweight Charts 5.2.1</span></div><div class="controls"><label>合约 <select id="mc-symbol"><option value="BTCUSDT">BTC / USDT</option><option value="ETHUSDT">ETH / USDT</option></select></label><label>周期 <select id="mc-interval"><option value="5m">5 分钟</option><option value="15m">15 分钟</option><option value="1h" selected>1 小时</option><option value="4h">4 小时</option><option value="1d">1 天</option></select></label><button id="mc-ma" aria-pressed="true">隐藏 MA20</button><button id="mc-fit">显示全部</button><button id="mc-refresh">刷新行情</button></div><p id="mc-status" role="status" aria-live="polite">正在初始化图表…</p><div id="mc-quote" class="market-chart-quote">等待行情</div><div id="mc-canvas" class="market-chart-canvas" aria-label="合约价格、均线与成交量图表"></div><p class="hint">每 15 秒轮询最新行情；最后一根 K 线可能尚未收盘。成交量单位为基础币，MA20 按当前收盘价计算。网络失败时保留当前合约的旧数据并标注；切换合约或周期后清空旧图。</p><details><summary>图表说明与署名</summary><p>滚轮缩放，拖动平移，十字线查看 OHLC。仅展示行情，不执行交易。数据缺口保留，均线在连续 20 根 K 线后绘制。</p><p>TradingView Lightweight Charts™<br>Copyright (с) 2025 TradingView, Inc. <a href="https://www.tradingview.com/" target="_blank" rel="noopener">TradingView</a> · <a href="vendor/lightweight-charts/NOTICE">NOTICE</a> · <a href="vendor/lightweight-charts/LICENSE">Apache 2.0</a></p></details></section>`;
  const $=id=>target.querySelector('#'+id),symbol=$('mc-symbol'),period=$('mc-interval'),status=$('mc-status'),quote=$('mc-quote');
  let disposed=false,chart,candles,volume,ma,timer,controller,generation=0,rows=[],hasData=false,shown=true,lastSuccess='';
  function showQuote(b){quote.textContent=b?`${clock(b.time)}　开 ${b.open.toFixed(2)}　高 ${b.high.toFixed(2)}　低 ${b.low.toFixed(2)}　收 ${b.close.toFixed(2)}　${b.closed?'已收盘':'形成中'}`:'等待行情';}
  function dispose(){disposed=true;generation++;clearTimeout(timer);controller?.abort();document.removeEventListener('visibilitychange',visibility);chart?.remove();}
  function visibility(){if(!document.hidden&&chart)load(false);}
  async function load(reset){
   const request=++generation;clearTimeout(timer);controller?.abort();controller=new AbortController();const control=controller;
   const contract=symbol.value,interval=period.value,step=intervals[interval];
   if(reset){hasData=false;rows=[];lastSuccess='';candles.setData([]);volume.setData([]);ma.setData([]);showQuote(null);}
   status.textContent=`正在读取 ${contract} / ${interval}…`;
   const timeout=setTimeout(()=>control.abort(),12000);
   try{
    const url=new URL('https://fapi.binance.com/fapi/v1/klines');Object.entries({symbol:contract,interval,limit:500}).forEach(([k,v])=>url.searchParams.set(k,v));
    const response=await fetch(url,{signal:control.signal,cache:'no-store',credentials:'omit'});if(!response.ok)throw Error('HTTP '+response.status);
    const next=normalize(await response.json(),interval);
    if(disposed||request!==generation)return;
    rows=next;const fit=!hasData;
    candles.setData(padded(rows.map(({volume,closed,...b})=>b),step));
    volume.setData(padded(rows.map(b=>({time:b.time,value:b.volume,color:b.close>=b.open?'#287e6a':'#874b56'})),step));
    ma.setData(averages(rows,step));hasData=true;lastSuccess=new Date().toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
    if(fit)chart.timeScale().fitContent();showQuote(rows.at(-1));
    status.textContent=`${contract} · ${interval} · ${rows.length} 根 · 获取时间 ${lastSuccess} 北京时间 · 最新 K 线 ${clock(rows.at(-1).time)}${Date.now()/1000-rows.at(-1).time>step*2?' · 数据已滞后':''}`;
   }catch(e){if(disposed||request!==generation)return;status.textContent=`行情读取失败（${e.name==='AbortError'?'请求超时':e.message}）。${hasData?'保留上次数据，获取时间 '+lastSuccess+' 北京时间；当前非最新行情。':'暂无数据，请检查到 Binance 的连接后重试。'}`;}
   finally{clearTimeout(timeout);if(!disposed&&request===generation)schedule();}
  }
  function schedule(){timer=setTimeout(()=>{if(document.hidden)schedule();else load(false);},15000);}
  document.addEventListener('visibilitychange',visibility);
  import('./vendor/lightweight-charts/lightweight-charts-5.2.1.mjs').then(L=>{
   if(disposed)return;
   chart=L.createChart($('mc-canvas'),{autoSize:true,layout:{background:{color:'#101820'},textColor:'#a4b6be',attributionLogo:true},grid:{vertLines:{color:'#1f2b32'},horzLines:{color:'#1f2b32'}},localization:{timeFormatter:clock},timeScale:{timeVisible:true,secondsVisible:false,tickMarkFormatter:t=>{const d=new Date(t*1000);return period.value==='1d'?d.toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit'}):d.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});}}});
   candles=chart.addSeries(L.CandlestickSeries,{upColor:'#56c6a4',downColor:'#ee8b96',wickUpColor:'#56c6a4',wickDownColor:'#ee8b96',borderVisible:false});
   ma=chart.addSeries(L.LineSeries,{color:'#dcb976',lineWidth:2,title:'MA20',lastValueVisible:false,priceLineVisible:false});
   volume=chart.addSeries(L.HistogramSeries,{priceScaleId:'volume',priceFormat:{type:'volume'}});
   candles.priceScale().applyOptions({scaleMargins:{top:.08,bottom:.25}});volume.priceScale().applyOptions({scaleMargins:{top:.82,bottom:0}});
   chart.subscribeCrosshairMove(p=>{const b=p.seriesData.get(candles);showQuote(b&&'close'in b?{...b,closed:b.time+intervals[period.value]<=Date.now()/1000}:rows.at(-1));});
   symbol.onchange=period.onchange=()=>load(true);$('mc-refresh').onclick=()=>load(false);$('mc-fit').onclick=()=>chart.timeScale().fitContent();$('mc-ma').onclick=()=>{shown=!shown;ma.applyOptions({visible:shown});$('mc-ma').textContent=shown?'隐藏 MA20':'显示 MA20';$('mc-ma').setAttribute('aria-pressed',String(shown));};load(true);
  }).catch(()=>{if(!disposed)status.textContent='图表库加载失败，请刷新页面重试。';});
  return dispose;
 };
})(typeof window!=='undefined'?window:globalThis);
