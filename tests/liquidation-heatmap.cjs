const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
const c={window:{},esc:String,date:v=>v||'暂无'};vm.runInNewContext(fs.readFileSync('liquidation-heatmap.js','utf8'),c);const {model,svg}=c.window.LiquidationHeatmap;
const now=Date.parse('2026-10-26T14:00:00Z'),r={id:'one',symbol:'BTC',contract:'BTC-USDT-SWAP',time:'2026-10-26T13:10:00Z',pos_side:'long',bankruptcy_price:100,raw_sz:'999999'};
test('heat density counts saved deduplicated observations, never raw unverified sizes',()=>{
 const m=model([r,r,{...r,id:'two',pos_side:'short'}],[],'BTC',1,'all',now);assert.equal(m.rows.length,2);assert.equal(m.cells.length,1);assert.equal(m.cells[0].count,2);assert.equal(m.cells[0].longs,1);assert.equal(m.cells[0].shorts,1);assert.equal(m.maxCount,2);assert.doesNotMatch(svg(m,'BTC'),/999999条|raw_sz|NaN|Infinity/);
});
test('symbol side time and invalid price filters are applied before binning',()=>{
 const m=model([r,{...r,id:'b',symbol:'ETH'},{...r,id:'c',time:'2026-10-27T00:00:00Z'},{...r,id:'d',bankruptcy_price:NaN},{...r,id:'e',pos_side:'short'}],[],'BTC',1,'long',now);assert.equal(m.rows.length,1);
});
test('no observations retain explicit unknown coverage instead of zero-market claim',()=>{
 const m=model([],[],'BTC',1,'all',now);assert.equal(m.maxCount,0);assert.match(svg(m,'BTC'),/不能据此判断没有强平/);assert.doesNotMatch(svg(m,'BTC'),/NaN|Infinity/);
});
test('source-time price line breaks over two-hour gaps and threshold hides only low-count cells',()=>{
 const prices=[{symbol:'BTC',price:100,time:'2026-10-26T09:00:00Z'},{symbol:'BTC',price:101,time:'2026-10-26T13:00:00Z'}];
 const m=model([r,{...r,id:'two'},{...r,id:'three',time:'2026-10-26T12:00:00Z'}],prices,'BTC',1,'all',now);const plot=svg(m,'BTC',100);assert.equal((plot.match(/<path d=/g)||[]).length,2);assert.match(plot,/已保存 2 条/);assert.doesNotMatch(plot,/已保存 1 条/);
});
test('potential-distribution tab remains explicitly unconnected and disables export',()=>{
 const nodes={};const ids=['#heat-liq-symbol','#heat-liq-range','#heat-liq-side','#heat-liq-threshold','#heat-liq-palette','#heat-liq-status','#heat-liq-chart','#heat-liq-summary','#heat-liq-threshold-label','#heat-liq-observed','#heat-liq-model','#heat-liq-export','#heat-liq-legacy'];
 for(const id of ids)nodes[id]={innerHTML:'',handlers:{},setAttribute:()=>{},addEventListener(k,f){this.handlers[k]=f;}};
 for(const [id,value] of [['symbol','BTC'],['range','1'],['side','all'],['threshold','0'],['palette','classic']])nodes['#heat-liq-'+id].value=value;
 c.window.LIQUIDATIONS_DATA={records:[],states:{}};c.window.PRICE_DATA={records:[]};c.window.renderLiquidations=()=>{};
 c.window.renderLiquidationHeatmap({innerHTML:'',querySelector:k=>nodes[k]});nodes['#heat-liq-model'].handlers.click();assert.match(nodes['#heat-liq-chart'].innerHTML,/暂不绘制估算色带/);assert.equal(nodes['#heat-liq-export'].disabled,true);nodes['#heat-liq-observed'].handlers.click();assert.equal(nodes['#heat-liq-export'].disabled,false);
});
test('five-minute candle line keeps missing slots visible and 24-hour event bins use five minutes',()=>{
 const prices=[{symbol:'BTC',price:100,time:'2026-10-26T13:00:00Z',interval_minutes:5},{symbol:'BTC',price:101,time:'2026-10-26T13:10:00Z',interval_minutes:5}];
 const m=model([r],prices,'BTC',1,'all',now);assert.equal(m.columns,288);assert.equal((svg(m,'BTC').match(/<path d=/g)||[]).length,2);
});
