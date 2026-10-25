const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
const stamp=new Date().toISOString();
function setup(data){const ids={'#liq-symbol':{value:'BTC'},'#liq-days':{value:'1'},'#liq-result':{}};Object.values(ids).forEach(i=>i.addEventListener=(_,f)=>i.change=f);const c={window:{LIQUIDATIONS_DATA:data},date:v=>v||'暂无',esc:String};for(const f of ['oi-ui.js','liquidations-ui.js'])vm.runInNewContext(fs.readFileSync(f,'utf8'),c);c.window.renderLiquidations({innerHTML:'',querySelector:k=>ids[k],querySelectorAll:()=>[ids['#liq-symbol'],ids['#liq-days']]});return {ids,c};}
test('empty response never claims that the market had zero liquidations',()=>assert.match(setup({records:[],attempts:[],states:{}}).ids['#liq-result'].innerHTML,/不代表没有强平/));
test('capped observations are disclosed with bankruptcy-price scatter and raw unverified size',()=>{
 const r={symbol:'BTC',time:stamp,pos_side:'long',order_side:'sell',bankruptcy_price:100,raw_sz:'1',first_seen:stamp};
 const x=setup({attempted_at:stamp,records:[r],attempts:[],states:{BTC:{status:'ok',returned:100,accepted:1,new_observed:1,limit_reached:true}}});const html=x.ids['#liq-result'].innerHTML;assert.match(html,/可能遗漏/);assert.match(html,/非成交价/);assert.match(html,/单位未核验/);assert.doesNotMatch(html,/NaN|Infinity/);
 const v=x.c.window.LiquidationView({records:[r,{...r,symbol:'ETH'}]},'BTC',1);assert.equal(v.rows.length,1);
});
