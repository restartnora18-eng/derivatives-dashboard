const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const chart=require('../history-chart.js');
const end=Date.parse('2026-10-25T04:00:00Z');
function bundle(points){return {last_attempt:{requested_end:new Date(end).toISOString()},series:{'okx:BTC':{
  venue:'okx',base:'BTC',symbol:'BTC-USDT-SWAP',points:points.map(([ago,value])=>({settled_at:new Date(end-ago*3600000).toISOString(),rate_percent:value}))}}};}
test('7 day / 30 day windows are anchored to explicitly recorded collection cutoff',()=>{
  const data=bundle([[2,0],[10,-.01],[200,.02],[800,.03]]);
  assert.equal(chart.view(data,'BTC','all',7).points.length,2);
  assert.equal(chart.view(data,'BTC','all',30).points.length,3);
});
test('missing venue remains empty rather than fabricated zeros',()=>{
  const view=chart.view(bundle([[2,0]]),'BTC','binance',7);
  assert.equal(view.points.length,0);
  assert.match(chart.svg(view),/暂无/);
});
test('zero and negative rates are plotted as real points without connecting gaps',()=>{
  const view=chart.view(bundle([[2,0],[10,-.01],[18,.02]]));
  const svg=chart.svg(view);
  assert.equal((svg.match(/<circle /g)||[]).length,3);
  assert.ok(!svg.includes('polyline'));
  assert.ok(!svg.includes('NaN'));
  assert.match(svg,/-0.01000%/);
  assert.match(svg,/0.00000%/);
});
test('unusual time gaps are disclosed as possible gaps or period changes',()=>{
  const view=chart.view(bundle([[2,0],[10,0],[18,0],[50,0],[58,0]]));
  assert.equal(view.gaps,1);
});
test('duplicate timestamps and malformed rate cannot add extra points',()=>{
  const view=chart.view(bundle([[2,0],[2,0],[10,NaN]]));
  assert.equal(view.points.length,1);
});
test('chart can display all-zero series with finite coordinates',()=>{
  assert.ok(!/NaN|Infinity/.test(chart.svg(chart.view(bundle([[2,0],[10,0]])))));
});
test('actual saved history bundle renders BTC and ETH at 7 and 30 days',()=>{
  const context={window:{}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../history-data.js'),'utf8'),context);
  const data=context.window.FUNDING_HISTORY;
  for(const base of ['BTC','ETH'])for(const days of [7,30]){
    const view=chart.view(data,base,'all',days);
    assert.ok(view.points.length>0);
    const svg=chart.svg(view);
    assert.equal((svg.match(/<circle /g)||[]).length,view.points.length);
    assert.ok(!/NaN|Infinity/.test(svg));
  }
});
