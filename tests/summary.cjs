const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
const now=Date.now(),stamp=new Date(now-1000).toISOString(),expiry=new Date(now+30*864e5).toISOString();
function context(){const r={symbol:'BTC',time:stamp,coin:10,price:100,premium_pct:0};const f={symbol:'BTC',time:stamp,contract:'BTC-USD-A',quote_ccy:'USD',settle_ccy:'BTC',contract_type:'inverse',expiry,basis_pct:1};
 const c={window:{PRICE_DATA:{records:[r]},OI_DATA:{records:[r]},BASIS_DATA:{records:[r]},FUNDING_HISTORY:{series:{'okx:BTC':{points:[{settled_at:stamp,rate_percent:0}]}}},FUTURES_DATA:{snapshots:{BTC:{records:[f]}},records:[f,{...f,contract:'BTC-USD-B',basis_pct:2}]}}};vm.runInNewContext(fs.readFileSync('summary-ui.js','utf8'),c);return c;}
test('summary shares a real time window, preserves zero and keeps a single futures contract',()=>{
 const c=context(),v=c.window.SummarySeries('BTC',1,now);assert.equal(v.bounds[0],now-864e5);assert.equal(v.series.length,5);
 assert.equal(v.series[2].rows[0].value,0);assert.equal(v.series[4].rows.length,1);assert.match(v.series[4].title,/BTC-USD-A/);
 assert.equal(v.series[2].pointsOnly,true);
});
test('missing currency remains empty and no old or future observation is backfilled',()=>{
 const c=context();assert.ok(c.window.SummarySeries('ETH',1,now).series.every(s=>s.rows.length===0));
 c.window.PRICE_DATA.records.push({symbol:'BTC',time:new Date(now+1000).toISOString(),price:3},{symbol:'BTC',time:new Date(now-2*864e5).toISOString(),price:1});
 assert.equal(c.window.SummarySeries('BTC',1,now).series[0].rows.length,1);
});
