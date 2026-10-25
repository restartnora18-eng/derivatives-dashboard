const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function render(records){
  const inputs={'#oi-symbol':{value:'BTC'},'#oi-unit':{value:'usd'},'#oi-range':{value:'7'},'#oi-result':{innerHTML:''}};
  for(const i of Object.values(inputs))i.addEventListener=(_,f)=>i.change=f;
  const target={innerHTML:'',querySelector:k=>inputs[k],querySelectorAll:()=>Object.values(inputs).slice(0,3)};
  const context={window:{OI_DATA:{records,states:{BTC:{status:'ok'}},attempted_at:new Date().toISOString()}},date:v=>v||'暂无',esc:v=>String(v),pct:v=>v.toFixed(2)+'%',console};
  vm.runInNewContext(fs.readFileSync('oi-ui.js','utf8'),context);
  context.window.renderOI(target);
  return {inputs,html:()=>inputs['#oi-result'].innerHTML};
}
const now=Date.now();
const row=(offset,usd=0)=>({symbol:'BTC',contract:'BTC-USDT-SWAP',time:new Date(now-offset).toISOString(),usd,coin:1,contracts:100});
test('empty and singleton do not fabricate a change or trend',()=>{
  assert.match(render([]).html(),/暂无区间数据/);
  const r=render([row(0)]);assert.match(r.html(),/积累中/);assert.doesNotMatch(r.html(),/NaN|Infinity/);
});
test('gaps are broken and zero baseline is not divided by zero',()=>{
  const r=render([row(4*36e5),row(0,10)]);assert.equal((r.html().match(/<polyline/g)||[]).length,2);assert.doesNotMatch(r.html(),/NaN|Infinity/);
});
test('unit and symbol switches update the chart and current observation',()=>{
  const r=render([row(36e5,80000),row(0,90000)]);assert.match(r.html(),/12.50%/);
  r.inputs['#oi-unit'].value='contracts';r.inputs['#oi-unit'].change();assert.match(r.html(),/0.00%/);assert.match(r.html(),/单位 张/);
  r.inputs['#oi-symbol'].value='ETH';r.inputs['#oi-symbol'].change();assert.match(r.html(),/暂无区间数据/);
});
test('price and OI panels share x coordinates while retaining independent units',()=>{
  const context={window:{},date:v=>v,esc:String};vm.runInNewContext(fs.readFileSync('oi-ui.js','utf8'),context);
  const bounds=[now-36e5,now];
  const oi=context.window.OIChart([row(0,90000)],'usd','OI','USD',bounds,'green');
  const price=context.window.OIChart([{time:new Date(now).toISOString(),price:80000}],'price','价格','USDT',bounds,'blue');
  assert.match(oi,/cx="925"/);assert.match(price,/cx="925"/);assert.match(price,/80000|80,000/);assert.match(price,/USDT/);
  assert.match(context.window.OIChart([],'price','价格','USDT',bounds,'blue'),/暂无区间数据/);
});
