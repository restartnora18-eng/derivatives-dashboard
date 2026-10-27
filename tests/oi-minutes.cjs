const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
const c={window:{},esc:String,date:v=>v||'暂无'};vm.runInNewContext(fs.readFileSync('oi-minutes-ui.js','utf8'),c);const api=c.window.MinuteOI,now=Date.parse('2026-10-27T02:00:00Z');
test('five minute series preserves zero, excludes future and reports missing internal slots',()=>{
 const records=[{time:new Date(now-15*6e4).toISOString(),coin:0},{time:new Date(now-5*6e4).toISOString(),coin:2},{time:new Date(now+5*6e4).toISOString(),coin:5}];
 const v=api.select({records,prices:[]},6,'coin',now);assert.equal(v.rows.length,2);assert.equal(v.rows[0].coin,0);assert.equal(v.missing,1);assert.equal(v.change,null);
});
test('minute chart breaks a ten minute gap and renders finite all-zero observations',()=>{
 const rows=[{time:new Date(now-15*6e4).toISOString(),coin:0},{time:new Date(now-5*6e4).toISOString(),coin:0}];const html=api.chart(rows,'coin',[now-36e5,now],'BTC OI','BTC','green');assert.equal((html.match(/<path d=/g)||[]).length,2);assert.doesNotMatch(html,/NaN|Infinity/);assert.match(html,/5分钟真实采样/);
});
test('minute renderer exposes sources and retains hourly module without auto-polling',()=>{
 const nodes={};for(const id of ['#minute-oi-hours','#minute-oi-unit','#minute-oi-result','#minute-oi-export','.minute-oi-legacy','#minute-oi-hourly'])nodes[id]={innerHTML:'',addEventListener:()=>{}};
 nodes['#minute-oi-hours'].value='24';nodes['#minute-oi-unit'].value='coin';c.window.OI_MINUTES_DATA={records:[],prices:[],states:{}};const target={innerHTML:'',querySelector:k=>nodes[k]};c.window.renderMinuteOI(target);assert.match(target.innerHTML,/1分钟历史不受该接口支持/);assert.match(target.innerHTML,/每小时抓取新增5分钟记录/);assert.doesNotMatch(nodes['#minute-oi-result'].innerHTML,/NaN|Infinity/);
});
test('overlay has two independent unit axes but one shared time coordinate',()=>{
 const stamp=new Date(now-300000).toISOString(),view={rows:[{time:stamp,coin:30000}],prices:[{time:stamp,price:80000}],bounds:[now-36e5,now]};
 const html=api.overlay(view,'coin','BTC');assert.equal((html.match(/<svg /g)||[]).length,1);assert.match(html,/左轴USDT价格，右轴BTC未平仓量/);assert.match(html,/data-oi-series="price"/);assert.match(html,/data-oi-series="oi"/);const positions=[...html.matchAll(/<circle cx="([^"]+)"/g)].map(m=>m[1]);assert.equal(positions[0],positions[1]);assert.doesNotMatch(html,/NaN|Infinity/);
});
test('overlay preserves per-series missing timestamps and breaks each ten minute gap',()=>{
 const view={rows:[{time:new Date(now-15*6e4).toISOString(),usd:0},{time:new Date(now-5*6e4).toISOString(),usd:0}],prices:[{time:new Date(now-10*6e4).toISOString(),price:80000}],bounds:[now-36e5,now]};
 const html=api.overlay(view,'usd','USD');assert.equal((html.match(/<circle /g)||[]).length,3);assert.equal((html.match(/<path d=/g)||[]).length,3);assert.doesNotMatch(html,/NaN|Infinity/);assert.doesNotMatch(api.overlay({...view,prices:[]},'usd','USD'),/NaN|Infinity/);
});
