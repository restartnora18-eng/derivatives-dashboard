const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
const c={window:{},esc:String,date:v=>v||'暂无'};for(const f of ['summary-ui.js','overview-wall.js'])vm.runInNewContext(fs.readFileSync(f,'utf8'),c);const now=Date.now(),stamp=new Date(now-36e5).toISOString();
test('overview represents six distinct modules in requested order with a shared time range',()=>{
 const v=c.window.OverviewWall.series('BTC',1,now);assert.deepEqual(Array.from(v.cards,s=>s.id),['funding','oi','basis','liquidations','options','orderbook']);assert.equal(v.bounds[1],now);assert.equal(v.bounds[0],now-864e5);
});
test('strong liquidation sample bar groups by source hour and deduplicates without summing raw sizes',()=>{
 const r={id:'a',symbol:'BTC',time:stamp,pos_side:'long',raw_sz:'999999'};c.window.LIQUIDATIONS_DATA={records:[r,r,{...r,id:'b',time:new Date(Date.parse(stamp)+1000).toISOString()},{...r,id:'c',symbol:'ETH'}],states:{}};
 const s=c.window.OverviewWall.series('BTC',1,now).cards[3];assert.equal(s.rows.length,1);assert.equal(s.rows[0].value,2);assert.equal(s.rows[0].time,new Date(Date.parse(stamp)+1000).toISOString());
});
test('chart handles zero and gaps without nonfinite values and funding dots never join',()=>{
 const rows=[{time:new Date(now-5*36e5).toISOString(),v:0},{time:stamp,v:1}];const chart=c.window.OverviewWall.chart;
 assert.equal((chart(rows,'v','test','%',[now-864e5,now],'red').match(/<path d=/g)||[]).length,2);assert.doesNotMatch(chart(rows,'v','test','%',[now-864e5,now],'red',{pointsOnly:true}),/<path d=/);assert.doesNotMatch(chart([{time:stamp,v:0}],'v','test','%',[now-864e5,now],'red'),/NaN|Infinity/);
});
