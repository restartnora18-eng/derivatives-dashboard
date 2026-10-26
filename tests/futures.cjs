const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
const now=Date.now(),expiry=new Date(now+30*864e5).toISOString();
const row={symbol:'BTC',quote_ccy:'USD',settle_ccy:'BTC',contract_type:'inverse',index_id:'BTC-USD',contract:'BTC-USD-TEST',time:new Date(now).toISOString(),expiry,days_remaining:30,basis_pct:1,annualized_pct:12.1667,mark:101,index:100,mark_time:new Date(now).toISOString(),index_time:new Date(now).toISOString(),skew_seconds:0};
function render(data){
 const ids={'#futures-symbol':{value:'BTC'},'#futures-unit':{value:'basis_pct'},'#futures-contract':{value:'BTC-USD-TEST'},'#futures-range':{value:'7'},'#futures-current':{querySelectorAll:()=>[]},'#futures-curve':{},'#futures-history':{}};
 Object.values(ids).forEach(i=>i.addEventListener=(_,f)=>i.change=f);
 const target={innerHTML:'',querySelector:k=>ids[k]};
 const context={window:{FUTURES_DATA:data},date:v=>v||'暂无',esc:String,pct:(v,d=2)=>v.toFixed(d)+'%'};
 for(const file of ['oi-ui.js','futures-ui.js'])vm.runInNewContext(fs.readFileSync(file,'utf8'),context);
 context.window.renderFutures(target);return {ids,context};
}
test('term structure connects maturities but history preserves two-hour gaps',()=>{
 const x=render({records:[row],states:{BTC:{status:'ok'}},snapshots:{BTC:{captured_at:row.time,records:[row,{...row,contract:'BTC-USD-NEXT',expiry:new Date(now+90*864e5).toISOString()}]}}});
 assert.equal((x.ids['#futures-curve'].innerHTML.match(/<polyline/g)||[]).length,1);
 assert.match(x.ids['#futures-history'].innerHTML,/BTC-USD-TEST/);assert.doesNotMatch(x.ids['#futures-history'].innerHTML,/NaN|Infinity/);
});
test('near expiry suppresses annualized point and expired contracts leave curve',()=>{
 const x=render({records:[],states:{},snapshots:{BTC:{captured_at:row.time,records:[{...row,expiry:new Date(now-1000).toISOString(),annualized_pct:null,near_expiry:true}]}}});
 assert.match(x.ids['#futures-current'].innerHTML,/已到期/);assert.match(x.ids['#futures-current'].innerHTML,/不足 1 天/);
 assert.doesNotMatch(x.ids['#futures-current'].innerHTML,/<polyline/);
});

test('USD inverse panel excludes an incompatible retained USDT snapshot',()=>{
 const x=render({records:[{...row,quote_ccy:'USDT',contract_type:'linear',settle_ccy:'USDT'}],states:{},snapshots:{BTC:{captured_at:row.time,records:[{...row,quote_ccy:'USDT',contract_type:'linear',settle_ccy:'USDT'}]}}});
 assert.doesNotMatch(x.ids['#futures-current'].innerHTML,/<polyline/);
 assert.match(x.ids['#futures-current'].innerHTML,/暂无可展示的真实合约数据/);
});

test('futures sorting keeps missing annualization last in both directions',()=>{
 const {context}=render({records:[],states:{},snapshots:{}});
 for(const direction of [-1,1]){
 const result=context.window.sortFuturesRows([{annualized_pct:null},{annualized_pct:0},{annualized_pct:-2}], 'annualized_pct',direction);
 assert.equal(result.at(-1).annualized_pct,null);assert.equal(result[0].annualized_pct,direction===1?-2:0);
 }
});
test('contract comparison has honest missing OI and volume and paired index details',()=>{
 const {ids}=render({records:[row],states:{BTC:{status:'ok'}},snapshots:{BTC:{captured_at:row.time,records:[row]}}});
 const html=ids['#futures-current'].innerHTML;
 assert.match(html,/持仓量 · USD/);assert.match(html,/24h 成交量 · USD/);assert.match(html,/尚未接入/);assert.match(html,/BTC-USD/);assert.doesNotMatch(html,/NaN|Infinity/);
});
