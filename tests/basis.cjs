const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
function render(records,states={BTC:{status:'ok'}}){
 const inputs={'#basis-symbol':{value:'BTC'},'#basis-range':{value:'7'},'#basis-result':{innerHTML:''}};
 for(const i of Object.values(inputs))i.addEventListener=(_,f)=>i.change=f;
 const target={innerHTML:'',querySelector:k=>inputs[k],querySelectorAll:()=>Object.values(inputs).slice(0,2)};
 const context={window:{BASIS_DATA:{records,states}},date:v=>v||'暂无',esc:String,pct:(v,n=2)=>v.toFixed(n)+'%'};
 for(const file of ['oi-ui.js','basis-ui.js'])vm.runInNewContext(fs.readFileSync(file,'utf8'),context);
 context.window.renderBasis(target);return {inputs,html:()=>inputs['#basis-result'].innerHTML};
}
const r={symbol:'BTC',time:new Date().toISOString(),premium_pct:-.0012,spread:-1,mark:99999,index:100000,skew_seconds:1};
test('empty basis does not show synthetic zeros',()=>assert.match(render([]).html(),/暂无区间数据/));
test('small negative premium retains precision and a zero reference',()=>{
 const s=render([r]).html();assert.match(s,/-0.0012%/);assert.match(s,/stroke-dasharray/);assert.doesNotMatch(s,/NaN|Infinity/);
});
test('failure and currency switch disclose retained or missing series',()=>{
 const x=render([r],{BTC:{status:'failed',code:'time_skew'}});assert.match(x.html(),/保留上次观测/);assert.match(x.html(),/time_skew/);
 x.inputs['#basis-symbol'].value='ETH';x.inputs['#basis-symbol'].change();assert.match(x.html(),/暂无区间数据/);
});
