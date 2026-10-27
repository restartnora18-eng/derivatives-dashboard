"""BTC-USDT-SWAP real 5-minute OI history; hourly backfill, no local daemon."""
import json,time
from datetime import timedelta
from pathlib import Path
from collect_funding import get_json,finite_number,timestamp_ms,parse_time,utc_now,atomic_text,serialize,DataError
ROOT=Path(__file__).resolve().parent
BASE='https://www.okx.com/api/v5'
CONTRACT='BTC-USDT-SWAP'
STEP=300000
PATHS={'oi':'/rubik/stat/contracts/open-interest-history','prices':'/market/history-mark-price-candles'}

def normalize(row,kind,now):
 if not isinstance(row,list) or len(row)<(4 if kind=='oi' else 6):raise DataError('invalid_row','历史记录结构无效')
 ms=int(finite_number(row[0]));stamp=timestamp_ms(ms)
 if not stamp or ms%STEP or parse_time(stamp)>parse_time(now)+timedelta(seconds=60):raise DataError('invalid_time','时间无效或不是5分钟边界')
 if kind=='oi':
  values={k:finite_number(v) for k,v in zip(('contracts','coin','usd'),row[1:4])}
  if any(v<0 for v in values.values()):raise DataError('negative_oi','OI不能为负')
  return dict(values,time=stamp)
 if row[5]!='1':return None
 values={k:finite_number(v) for k,v in zip(('open','high','low','close'),row[1:5])}
 if any(v<=0 for v in values.values()) or not values['low']<=min(values['open'],values['close'])<=max(values['open'],values['close'])<=values['high']:raise DataError('invalid_price','K线价格关系无效')
 end=timestamp_ms(ms+STEP)
 if parse_time(end)>parse_time(now):return None
 return dict(values,time=end,opened_at=stamp,price=values['close'])

def fetch(kind,old,previous_state,now,request=get_json,pause=time.sleep):
 cutoff=parse_time(now)-timedelta(days=5)
 prior_latest=max((parse_time(r['time']) for r in old),default=None)
 stop=prior_latest-timedelta(minutes=5) if prior_latest and previous_state.get('backfill_finished') else cutoff
 params={'instId':CONTRACT,'limit':'100',**({'period':'5m'} if kind=='oi' else {'bar':'5m'})}
 accepted={};pages=0;rejected=0;oldest=None;finished=False;error=None
 for _ in range(16):
  try:
   p=request(BASE+PATHS[kind],params);pages+=1
   if str(p.get('code'))!='0' or not isinstance(p.get('data'),list):raise DataError('api_error','历史接口状态或结构无效')
   raw=p['data']
   if not raw:finished=True;break
   stamps=[]
   for row in raw:
    try:
     item=normalize(row,kind,now)
     if item and parse_time(item['time'])>=parse_time(now)-timedelta(days=30):accepted[item['time']]=item
     stamps.append(int(finite_number(row[0])))
    except (DataError,ValueError,TypeError,OverflowError):rejected+=1
   if not stamps:raise DataError('no_valid_times','本页没有有效时间')
   cursor=min(stamps)
   if oldest is not None and cursor>=oldest:raise DataError('pagination_stalled','分页未向前推进')
   oldest=cursor
   if parse_time(timestamp_ms(cursor))<=stop or len(raw)<100:finished=True;break
   params['end' if kind=='oi' else 'after']=str(cursor-1)
   pause(.25)
  except Exception as exc:error=getattr(exc,'code',type(exc).__name__);break
 if not finished and not error:error='page_limit'
 state={'status':'partial' if accepted and (error or rejected) else 'failed' if error else 'ok','pages':pages,'received':len(accepted),'rejected':rejected,'backfill_finished':bool(finished or previous_state.get('backfill_finished'))}
 if error:state['code']=error
 return list(accepted.values()),state

def collect(root=ROOT):
 root=Path(root);path=root/'data/oi-minutes/series.json';old=json.loads(path.read_text()) if path.exists() else {}
 now=utc_now();out={'symbol':'BTC','contract':CONTRACT,'venue':'okx','interval_minutes':5,'attempted_at':now,'states':{},'sources':PATHS}
 for kind in ('oi','prices'):
  prior=old.get('records' if kind=='oi' else 'prices',[])
  fresh,state=fetch(kind,prior,old.get('states',{}).get(kind,{}),now)
  merged={r['time']:r for r in prior if parse_time(r['time'])>=parse_time(now)-timedelta(days=30)};merged.update({r['time']:r for r in fresh})
  out['records' if kind=='oi' else 'prices']=sorted(merged.values(),key=lambda r:r['time'])[-8641:];out['states'][kind]=state
 atomic_text(path,serialize(out));atomic_text(root/'oi-minutes-data.js','window.OI_MINUTES_DATA = '+json.dumps(out,ensure_ascii=False,allow_nan=False,separators=(',',':'))+';\n');return out

if __name__=='__main__':
 result=collect();print(json.dumps({'states':result['states'],'oi':len(result['records']),'prices':len(result['prices']),'from':result['records'][0]['time'] if result['records'] else None,'to':result['records'][-1]['time'] if result['records'] else None}))
