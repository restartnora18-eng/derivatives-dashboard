"""Experimental bounded REST liquidation observations, never a market-wide total."""
import hashlib,json
from decimal import Decimal
from datetime import datetime,timezone,timedelta
from pathlib import Path
from collect_funding import get_json,finite_number,timestamp_ms,parse_time,utc_now,atomic_text,serialize,DataError
ROOT=Path(__file__).resolve().parent
ENDPOINT='https://www.okx.com/api/v5/public/liquidation-orders'
MAX_RECORDS=10000

def normalize(payload,symbol,now):
 if str(payload.get('code'))!='0' or not isinstance(payload.get('data'),list):raise DataError('api_error','接口状态或结构无效')
 records={};returned=0;rejected=0;matched=0
 for group in payload['data']:
  if group.get('instId')!=symbol+'-USDT-SWAP' or group.get('instType')!='SWAP':continue
  matched+=1
  if not isinstance(group.get('details'),list):raise DataError('invalid_details','details 不是列表')
  for raw in group['details']:
   returned+=1
   try:
    stamp=timestamp_ms(raw.get('ts'));side=raw.get('posSide');order_side=raw.get('side');price=finite_number(raw.get('bkPx'));size=finite_number(raw.get('sz'))
    if side not in ('long','short') or order_side!=('sell' if side=='long' else 'buy'):raise DataError('invalid_side','方向不符')
    if price<=0 or size<=0:raise DataError('invalid_value','价格或sz非正数')
    if not stamp or not -60<=(parse_time(now)-parse_time(stamp)).total_seconds()<=30*86400:raise DataError('invalid_time','时间超出30天范围')
    identity=[group['instId'],stamp,side,order_side,format(Decimal(str(raw['bkPx'])).normalize(),'f'),format(Decimal(str(raw['sz'])).normalize(),'f')]
    key=hashlib.sha256(json.dumps(identity,separators=(',',':')).encode()).hexdigest()
    records[key]={'id':key,'symbol':symbol,'contract':group['instId'],'venue':'okx','time':stamp,'pos_side':side,'order_side':order_side,'bankruptcy_price':price,'raw_sz':str(raw['sz']),'first_seen':now}
   except (DataError,ValueError,TypeError):rejected+=1
 if payload['data'] and not matched:raise DataError('contract_mismatch','返回非目标合约')
 return list(records.values()),{'returned':returned,'accepted':len(records),'rejected':rejected,'limit_reached':returned>=100}

def collect(root=ROOT):
 root=Path(root);path=root/'data/liquidations/series.json';old=json.loads(path.read_text()) if path.exists() else {'records':[],'attempts':[]}
 now=utc_now();cutoff=datetime.now(timezone.utc)-timedelta(days=30);records={r['id']:r for r in old.get('records',[]) if parse_time(r['time'])>=cutoff};states={};attempts=[r for r in old.get('attempts',[]) if parse_time(r['time'])>=cutoff];blocked=False
 for symbol in ('BTC','ETH'):
  try:
   if blocked:raise DataError('access_restricted','访问受限，跳过重复请求')
   p=get_json(ENDPOINT,{'instType':'SWAP','uly':symbol+'-USDT','state':'filled','limit':'100'})
   rs,info=normalize(p,symbol,now)
   if info['returned'] and not rs:raise DataError('no_valid_samples','返回记录全部未通过校验')
   new=[r for r in rs if r['id'] not in records]
   for r in rs:records.setdefault(r['id'],r)
   states[symbol]={'status':'ok','experimental':True,**info,'new_observed':len(new)}
   attempts.append({'symbol':symbol,'time':now,'new_observed':len(new),'new_longs':sum(r['pos_side']=='long' for r in new),'new_shorts':sum(r['pos_side']=='short' for r in new),'returned':info['returned'],'limit_reached':info['limit_reached']})
  except Exception as exc:
   code=getattr(exc,'code',type(exc).__name__);blocked=blocked or code in ('http_403','http_451');states[symbol]={'status':'failed','code':code,'experimental':True}
 ordered=sorted(records.values(),key=lambda r:(r['time'],r['id']));truncated=len(ordered)>MAX_RECORDS or old.get('storage_truncated',False)
 result={'attempted_at':now,'endpoint':ENDPOINT,'experimental':True,'coverage':'bounded_rest_observations_only','states':states,'storage_truncated':truncated,'records':ordered[-MAX_RECORDS:],'attempts':attempts[-2000:]}
 atomic_text(path,serialize(result));atomic_text(root/'liquidations-data.js','window.LIQUIDATIONS_DATA = '+json.dumps(result,ensure_ascii=False,allow_nan=False)+';\n');return result

if __name__=='__main__':collect()
