const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const model = require('../data-model.js');
const now = Date.parse('2026-10-25T04:00:00Z');
const row = {venue:'okx',base:'BTC',symbol:'BTC-USDT-SWAP',annualized_percent:10.95,
  interval_hours:8,source_time:'2026-10-25T04:00:00Z',funding_time:'2026-10-25T08:00:00Z',warnings:[]};
const wrap = records => ({snapshot:{captured_at:'2026-10-25T04:00:00Z',records}});
test('zero rate participates, unknown interval does not',()=>{
  const view=model.live(wrap([{...row,annualized_percent:0}, {...row,interval_hours:null,annualized_percent:null}]),now);
  assert.equal(view.rows[0].eligible,true);
  assert.equal(view.rows[1].eligible,false);
});
test('data expires even when the saved JSON once said it was good',()=>{
  const view=model.live(wrap([row]),now+31*60000);
  assert.equal(view.rows[0].eligible,false);
  assert.ok(view.rows[0].warnings.includes('source_stale'));
});
test('hourly cloud snapshots carry an explicit 90 minute freshness window',()=>{
  const bundle=wrap([row]);bundle.snapshot.max_source_age_seconds=5400;
  assert.equal(model.live(bundle,now+31*60000).rows[0].eligible,true);
  assert.equal(model.live(bundle,now+91*60000).rows[0].eligible,false);
});
test('future and invalid source time cannot enter valid ranking',()=>{
  for(const source_time of ['not-a-date','2026-10-26T04:00:00Z']) {
    assert.equal(model.live(wrap([{...row,source_time}]),now).rows[0].eligible,false);
  }
});
test('expired settlement is shown even if observation is recent',()=>{
  assert.ok(model.quality({...row,funding_time:'2026-10-25T03:00:00Z'},now).includes('funding_time_elapsed'));
});
test('last good snapshot and failed attempt remain distinct',()=>{
  const bundle=wrap([row]);bundle.last_attempt={captured_at:'2026-10-25T05:00:00Z',venues:{okx:{status:'failed'}}};
  const view=model.live(bundle,now);
  assert.equal(view.retained,true);
  assert.equal(view.rows.length,1);
  assert.equal(view.statuses.okx.status,'failed');
});
test('sorting keeps unknown annualization last, negative rates retain sign',()=>{
  const rows=model.live(wrap([row,{...row,base:'ETH',symbol:'ETH-USDT-SWAP',annualized_percent:-20},
    {...row,base:'SOL',symbol:'SOL-USDT-SWAP',interval_hours:null,annualized_percent:null}]),now).rows;
  assert.deepEqual(model.select(rows,'','all','low').map(r=>r.rate),[-20,10.95,null]);
  assert.deepEqual(model.select(rows,'','all','high').map(r=>r.rate),[10.95,-20,null]);
  assert.equal(model.select(rows,' btc ','okx').length,1);
  assert.equal(model.select(rows,'','binance').length,0);
});
test('legacy 0 is kept, empty exchange is not converted to 0',()=>{
  const view=model.legacy({captured_utc:'2026-10-24 18:54:30 UTC',venues:{binance:{},okx:{BTC:0}}});
  assert.equal(view.rows.length,1);assert.equal(view.rows[0].rate,0);
  assert.equal(view.statuses.binance.received,0);
  assert.equal(view.rows[0].interval_hours,null);
});
test('generated browser bundle matches the persisted latest JSON',()=>{
  const context={window:{}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../funding-data.js'),'utf8'),context);
  const snapshot=JSON.parse(fs.readFileSync(require.resolve('../data/latest.json'),'utf8'));
  assert.equal(JSON.stringify(context.window.FUNDING_DATA.snapshot),JSON.stringify(snapshot));
  const view=model.live(context.window.FUNDING_DATA,Date.parse(snapshot.captured_at));
  assert.equal(view.rows.length,snapshot.records.length);
});
