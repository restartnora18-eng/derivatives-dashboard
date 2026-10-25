"""Hourly 400-level perpetual order book snapshots; bounded-depth metrics only."""
import json
from datetime import datetime,timezone,timedelta
from pathlib import Path
from collect_funding import get_json,finite_number,timestamp_ms,parse_time,utc_now,atomic_text,serialize,DataError
ROOT=Path(__file__).resolve().parent
API='https://www.okx.com/api/v5/'

def data(p):
 if str(p.get('code'))!='0' or not isinstance(p.get('data'),list) or len(p['data'])!=1:raise DataError('api_error','接口状态或数据结构无效')
 return p['data'][0]

def normalize(instruments,book,symbol,now):
 i=data(instruments);r=data(book);contract=symbol+'-USDT-SWAP'
 if not (i.get('instId')==contract and i.get('instType')=='SWAP' and i.get('ctType')=='linear' and i.get('settleCcy')=='USDT' and i.get('ctValCcy')==symbol and i.get('state')=='live'):raise DataError('contract_mismatch','仅支持同币种面值的USDT线性永续')
 value=finite_number(i.get('ctVal'));mult=finite_number(i.get('ctMult'))
 if value<=0 or mult!=1:raise DataError('unsupported_multiplier','合约面值无效或乘数不为1，停止换算')
 stamp=timestamp_ms(r.get('ts'))
 if not stamp or not -60<=(parse_time(now)-parse_time(stamp)).total_seconds()<=180:raise DataError('stale_book','盘口来源时间过期')
 sides={}
 for side in ('bids','asks'):
  raw=r.get(side)
  if not isinstance(raw,list) or not 1<=len(raw)<=400:raise DataError('empty_book','盘口为空或超出400档')
  levels=[]
  for level in raw:
   price=finite_number(level[0]);contracts=finite_number(level[1])
   if price<=0 or contracts<=0:raise DataError('invalid_level','价格和挂单数量必须为正')
   levels.append({'price':price,'contracts':contracts,'coin':contracts*value,'notional':contracts*value*price})
  prices=[l['price'] for l in levels]
  if any((prices[j]>=prices[j-1] if side=='bids' else prices[j]<=prices[j-1]) for j in range(1,len(prices))):raise DataError('unordered_book','盘口排序或价格档位重复')
  sides[side]=levels
 bid=sides['bids'][0]['price'];ask=sides['asks'][0]['price']
 if ask<=bid:raise DataError('crossed_book','盘口交叉或锁定，不计算指标')
 mid=(bid+ask)/2;bands={}
 for bps in (10,25,50):
  low=mid*(1-bps/10000);high=mid*(1+bps/10000)
  buys=sum(l['notional'] for l in sides['bids'] if l['price']>=low);sells=sum(l['notional'] for l in sides['asks'] if l['price']<=high)
  complete=sides['bids'][-1]['price']<=low and sides['asks'][-1]['price']>=high
  bands[str(bps)]={'bid_usdt':buys,'ask_usdt':sells,'covered':complete,'imbalance_pct':(buys-sells)/(buys+sells)*100 if complete and buys+sells>0 else None}
 top_bid=sum(l['notional'] for l in sides['bids'][:20]);top_ask=sum(l['notional'] for l in sides['asks'][:20])
 top20=(top_bid-top_ask)/(top_bid+top_ask)*100 if min(len(sides['bids']),len(sides['asks']))>=20 and top_bid+top_ask>0 else None
 return {'top20_imbalance_pct':top20,'symbol':symbol,'contract':contract,'venue':'okx','time':stamp,'fetched_at':now,'mid':mid,'best_bid':bid,'best_ask':ask,'spread':ask-bid,'spread_bps':(ask-bid)/mid*10000,'imbalance25_pct':bands['25']['imbalance_pct'],'bands':bands,'ct_val':value,'ct_mult':mult,'ct_val_ccy':symbol,'bids':sides['bids'],'asks':sides['asks'],'bid_coverage_bps':(mid-sides['bids'][-1]['price'])/mid*10000,'ask_coverage_bps':(sides['asks'][-1]['price']-mid)/mid*10000}

def collect(root=ROOT):
 root=Path(root);path=root/'data/orderbook/series.json';old=json.loads(path.read_text()) if path.exists() else {'records':[],'snapshots':{}}
 now=utc_now();states={};snapshots=old.get('snapshots',{});new=[];blocked=False
 for symbol in ('BTC','ETH'):
  try:
   if blocked:raise DataError('access_restricted','访问受限，跳过重复请求')
   i=get_json(API+'public/instruments',{'instType':'SWAP','instId':symbol+'-USDT-SWAP'})
   b=get_json(API+'market/books',{'instId':symbol+'-USDT-SWAP','sz':'400'})
   r=normalize(i,b,symbol,now);snapshots[symbol]=r;new.append({k:v for k,v in r.items() if k not in ('bids','asks')});states[symbol]={'status':'ok'}
  except Exception as exc:
   code=getattr(exc,'code',type(exc).__name__);blocked=blocked or code in ('http_403','http_451');states[symbol]={'status':'failed','code':code}
 cutoff=datetime.now(timezone.utc)-timedelta(days=30)
 merged={(r['contract'],r['time']):r for r in old.get('records',[]) if parse_time(r['time'])>=cutoff};merged.update({(r['contract'],r['time']):r for r in new})
 result={'attempted_at':now,'states':states,'snapshots':snapshots,'records':sorted(merged.values(),key=lambda r:(r['time'],r['contract']))}
 atomic_text(path,serialize(result));atomic_text(root/'orderbook-data.js','window.ORDERBOOK_DATA = '+json.dumps(result,ensure_ascii=False,allow_nan=False)+';\n');return result

if __name__=='__main__':collect()
