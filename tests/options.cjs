const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
const now=Date.now(),expiry=new Date(now+30*864e5).toISOString(),stamp=new Date(now).toISOString();
const row={symbol:'BTC',expiry,time:stamp,days_remaining:30,atm_iv_pct:40,rr25_proxy_pp:null,atm_strike:100,atm_forward:100,quotes:[]};
function render(data){
 const ids={'#options-symbol':{value:'BTC'},'#options-metric':{value:'atm_iv_pct'},'#options-expiry':{value:expiry},'#options-days':{value:'7'},'#options-term':{},'#options-history':{}};
 Object.values(ids).forEach(i=>i.addEventListener=(_,f)=>i.change=f);
 const c={window:{OPTIONS_DATA:data},date:v=>v||'暂无',esc:String};for(const f of ['oi-ui.js','options-ui.js'])vm.runInNewContext(fs.readFileSync(f,'utf8'),c);
 c.window.renderOptions({innerHTML:'',querySelector:k=>ids[k]});return ids;
}
test('missing skew remains a disclosed missing value and fixed expiry history is not fabricated',()=>{
 const ids=render({attempted_at:stamp,records:[row],states:{BTC:{status:'ok'}},snapshots:{BTC:{captured_at:stamp,records:[row]}}});
 assert.match(ids['#options-term'].innerHTML,/缺少合格双腿/);assert.match(ids['#options-history'].innerHTML,/1 个有效观测/);
 ids['#options-metric'].value='rr25_proxy_pp';ids['#options-metric'].change();assert.match(ids['#options-history'].innerHTML,/0 个有效观测/);assert.doesNotMatch(ids['#options-history'].innerHTML,/NaN|Infinity/);
});
test('empty option snapshot remains empty',()=>assert.match(render({records:[],states:{},snapshots:{}})['#options-term'].innerHTML,/暂无有效期限/));
