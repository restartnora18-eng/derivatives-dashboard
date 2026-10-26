const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
const c={window:{},esc:String,date:v=>v||'暂无'};vm.runInNewContext(fs.readFileSync('liquidity-ui.js','utf8'),c);const charts=c.window.LiquidityCharts;
const now=Date.parse('2026-10-26T12:00:00Z'),start=now-864e5;
test('hourly source-time sampling keeps latest and excludes future or missing rows',()=>{
 const rows=[{time:'2026-10-26T10:01:00Z',v:1},{time:'2026-10-26T10:59:00Z',v:2},{time:'2026-10-26T13:00:00Z',v:3},{time:'invalid',v:4}];
 const result=charts.hourly(rows,start,now);assert.equal(result.length,1);assert.equal(result[0].v,2);
});
test('heatmap draws complete zero bins but does not replace uncovered bins with zero',()=>{
 const frame={symbol:'BTC',contract:'BTC-USDT-SWAP',time:'2026-10-26T10:30:00Z',mid:100,bin_bps:1,bids:[10,0,null],asks:[20,null,null]};
 const svg=charts.depthHeatmap([frame],'BTC',start,now);assert.match(svg,/挂单名义额 0 USDT/);assert.match(svg,/1 个小时快照/);assert.equal((svg.match(/<title>/g)||[]).length,3);assert.doesNotMatch(svg,/NaN|Infinity/);
 assert.match(charts.depthHeatmap([frame],'ETH',start,now),/暂无深度快照/);
});
test('liquidity scatter drops stale and failed snapshots instead of displaying them as current',()=>{
 const s={symbol:'BTC',contract:'BTC-USDT-SWAP',time:new Date(now-1000).toISOString(),spread_bps:.1,top20_imbalance_pct:0};
 const data={states:{BTC:{status:'ok'},ETH:{status:'failed'}},snapshots:{BTC:s,ETH:{...s,symbol:'ETH'}}};
 assert.match(charts.scatter(data,now),/1 \/ 2 个币种/);data.snapshots.BTC.time=new Date(now-2*36e5).toISOString();assert.match(charts.scatter(data,now),/0 \/ 2 个币种/);
});
test('screener accepts real zero, rejects null, and handles empty source without nonfinite SVG',()=>{
 const data={records:[{symbol:'BTC',time:'2026-10-26T10:30:00Z',top20_imbalance_pct:0},{symbol:'ETH',time:'2026-10-26T10:30:00Z',top20_imbalance_pct:null}]};
 const html=charts.screener(data,'top20_imbalance_pct',start,now);assert.match(html,/1 个有效观测/);assert.doesNotMatch(html,/NaN|Infinity/);
 assert.doesNotMatch(charts.screener({records:[]},'spread_bps',start,now),/NaN|Infinity/);
});
test('fallback snapshot uses actual notional and only fully covered 1bps bins',()=>{
 const s={symbol:'BTC',contract:'BTC-USDT-SWAP',time:'2026-10-26T10:30:00Z',mid:100,bids:[{price:99.995,notional:10},{price:99.985,notional:20}],asks:[{price:100.005,notional:30}],bid_coverage_bps:1.5,ask_coverage_bps:.5};
 const f=charts.snapshotFrame(s);assert.equal(f.bids[0],10);assert.equal(f.bids[1],null);assert.equal(f.asks[0],null);
});

test('four-panel renderer wires controls and retains detailed book tools',()=>{
 const nodes={};for(const id of ['#liquidity-symbol','#liquidity-range','#liquidity-metric','#liquidity-status','#liquidity-trend','#liquidity-scatter','#liquidity-depth','#liquidity-screen','#liquidity-legacy'])nodes[id]={innerHTML:'',addEventListener:()=>{}};
 nodes['#liquidity-symbol'].value='BTC';nodes['#liquidity-range'].value='1';nodes['#liquidity-metric'].value='spread_bps';
 c.window.ORDERBOOK_DATA={records:[],snapshots:{},states:{}};c.window.OIChart=()=>'<div>暂无数据</div>';let mounted=false;c.window.renderOrderbook=()=>mounted=true;
 const target={innerHTML:'',querySelector:k=>nodes[k]};c.window.renderLiquidity(target);
 assert.match(target.innerHTML,/DEPTH HEATMAP/);assert.match(target.innerHTML,/COIN COMPARISON/);assert.ok(mounted);assert.doesNotMatch(Object.values(nodes).map(n=>n.innerHTML).join(''),/NaN|Infinity/);
});
