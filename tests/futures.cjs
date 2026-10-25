const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
const now=Date.now(),expiry=new Date(now+30*864e5).toISOString();
const row={symbol:'BTC',contract:'BTC-USDT-TEST',time:new Date(now).toISOString(),expiry,days_remaining:30,basis_pct:1,annualized_pct:12.1667,mark:101,index:100,mark_time:new Date(now).toISOString(),index_time:new Date(now).toISOString(),skew_seconds:0};
function render(data){
 const ids={'#futures-symbol':{value:'BTC'},'#futures-unit':{value:'basis_pct'},'#futures-contract':{value:'BTC-USDT-TEST'},'#futures-range':{value:'7'},'#futures-current':{},'#futures-history':{}};
 Object.values(ids).forEach(i=>i.addEventListener=(_,f)=>i.change=f);
 const target={innerHTML:'',querySelector:k=>ids[k]};
 const context={window:{FUTURES_DATA:data},date:v=>v||'暂无',esc:String,pct:(v,d=2)=>v.toFixed(d)+'%'};
 for(const file of ['oi-ui.js','futures-ui.js'])vm.runInNewContext(fs.readFileSync(file,'utf8'),context);
 context.window.renderFutures(target);return {ids,context};
}
test('term structure connects maturities but history preserves two-hour gaps',()=>{
 const x=render({records:[row],states:{BTC:{status:'ok'}},snapshots:{BTC:{captured_at:row.time,records:[row,{...row,contract:'BTC-USDT-NEXT',expiry:new Date(now+90*864e5).toISOString()}]}}});
 assert.equal((x.ids['#futures-current'].innerHTML.match(/<polyline/g)||[]).length,1);
 assert.match(x.ids['#futures-history'].innerHTML,/BTC-USDT-TEST/);assert.doesNotMatch(x.ids['#futures-history'].innerHTML,/NaN|Infinity/);
});
test('near expiry suppresses annualized point and expired contracts leave curve',()=>{
 const x=render({records:[],states:{},snapshots:{BTC:{captured_at:row.time,records:[{...row,expiry:new Date(now-1000).toISOString(),annualized_pct:null,near_expiry:true}]}}});
 assert.match(x.ids['#futures-current'].innerHTML,/已到期/);assert.match(x.ids['#futures-current'].innerHTML,/不足 1 天/);
 assert.doesNotMatch(x.ids['#futures-current'].innerHTML,/<polyline/);
});
