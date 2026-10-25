"""OKX option mark-IV proxies at actual expiries; no constant-maturity interpolation."""
import json,math
from datetime import datetime,timezone,timedelta
from pathlib import Path
from collect_funding import get_json,finite_number,timestamp_ms,parse_time,utc_now,atomic_text,serialize,DataError
ROOT=Path(__file__).resolve().parent
API='https://www.okx.com/api/v5/'

def rows(p):
 if str(p.get('code'))!='0' or not isinstance(p.get('data'),list):raise DataError('api_error','接口数据无效')
 return p['data']

def quote(i,r,symbol,now):
 if i.get('instType')!='OPTION' or i.get('instFamily')!=symbol+'-USD' or i.get('settleCcy')!=symbol or i.get('state')!='live' or r.get('instId')!=i.get('instId') or r.get('instType')!='OPTION':raise DataError('contract_mismatch','合约口径不匹配')
 expiry=timestamp_ms(i.get('expTime'));stamp=timestamp_ms(r.get('ts'))
 if not expiry or not stamp or (parse_time(expiry)-parse_time(now)).total_seconds()<86400:raise DataError('invalid_expiry','距离到期不足一天')
 if not -60<=(parse_time(now)-parse_time(stamp)).total_seconds()<=180:raise DataError('stale_quote','期权来源时间过期')
 strike=finite_number(i.get('stk'));fwd=finite_number(r.get('fwdPx'));iv=finite_number(r.get('markVol'));delta=finite_number(r.get('deltaBS'));bid=finite_number(r.get('bidVol'));ask=finite_number(r.get('askVol'))
 if not (strike>0 and fwd>0 and 0<iv<=10 and 0<bid<=ask<=10):raise DataError('invalid_quote','缺少有效双边 IV 或价格字段')
 opt=i.get('optType')
 if not ((opt=='C' and 0<=delta<=1) or (opt=='P' and -1<=delta<=0)):raise DataError('invalid_delta','deltaBS 与期权类型不符')
 return {'contract':i['instId'],'expiry':expiry,'strike':strike,'type':opt,'forward':fwd,'iv_pct':iv*100,'delta_bs':delta,'time':stamp,'bid_iv_pct':bid*100,'ask_iv_pct':ask*100}

def calculate(instruments,summaries,symbol,now):
 inst={r['instId']:r for r in rows(instruments)};groups={};rejected=0
 for raw in rows(summaries):
  i=inst.get(raw.get('instId'))
  if not i:continue
  try:q=quote(i,raw,symbol,now);groups.setdefault(q['expiry'],[]).append(q)
  except (DataError,ValueError,TypeError):rejected+=1
 expiries=sorted(groups)
 selected=set()
 for target in (7,14,30,60,90):
  if expiries:selected.add(min(expiries,key=lambda e:abs((parse_time(e)-parse_time(now)).total_seconds()/86400-target)))
 records=[]
 for expiry in sorted(selected):
  qs=groups[expiry];pairs=[]
  for c in [q for q in qs if q['type']=='C']:
   ps=[p for p in qs if p['type']=='P' and p['strike']==c['strike']]
   if not ps:continue
   p=ps[0];distance=max(abs(math.log(c['strike']/c['forward'])),abs(math.log(p['strike']/p['forward'])))
   if distance<=.05 and abs((parse_time(c['time'])-parse_time(p['time'])).total_seconds())<=120:pairs.append((distance,c,p))
  if not pairs:continue
  _,c,p=min(pairs,key=lambda t:t[0]);atm=(c['iv_pct']+p['iv_pct'])/2
  calls=[q for q in qs if q['type']=='C' and abs(q['delta_bs']-.25)<=.03]
  puts=[q for q in qs if q['type']=='P' and abs(q['delta_bs']+.25)<=.03]
  call=min(calls,key=lambda q:abs(q['delta_bs']-.25)) if calls else None
  put=min(puts,key=lambda q:abs(q['delta_bs']+.25)) if puts else None
  skew=None
  if call and put and abs((parse_time(call['time'])-parse_time(put['time'])).total_seconds())<=120:skew=call['iv_pct']-put['iv_pct']
  else:call=put=None
  audit=[c,p]+([call,put] if call and put else [])
  if (max(parse_time(q['time']) for q in audit)-min(parse_time(q['time']) for q in audit)).total_seconds()>120:continue
  records.append({'symbol':symbol,'venue':'okx','family':symbol+'-USD','expiry':expiry,'time':max(q['time'] for q in audit),'fetched_at':now,'days_remaining':(parse_time(expiry)-parse_time(now)).total_seconds()/86400,'atm_iv_pct':atm,'rr25_proxy_pp':skew,'atm_strike':c['strike'],'atm_forward':c['forward'],'quotes':audit})
 return records,rejected

def collect(root=ROOT):
 root=Path(root);path=root/'data/options/series.json'
 previous=json.loads(path.read_text()) if path.exists() else {'records':[],'snapshots':{}}
 now=utc_now();states={};snapshots=previous.get('snapshots',{});new=[];blocked=False
 for symbol in ('BTC','ETH'):
  try:
   if blocked:raise DataError('access_restricted','访问受限，跳过重复请求')
   instruments=get_json(API+'public/instruments',{'instType':'OPTION','instFamily':symbol+'-USD'})
   summaries=get_json(API+'public/opt-summary',{'instFamily':symbol+'-USD'})
   result,rejected=calculate(instruments,summaries,symbol,now)
   if not result:raise DataError('no_valid_expiries','无满足新鲜度、配对和双边IV要求的期限')
   snapshots[symbol]={'captured_at':now,'records':result};new.extend(result)
   states[symbol]={'status':'ok','received':len(result),'skew_available':sum(r['rr25_proxy_pp'] is not None for r in result),'rejected_quotes':rejected,'returned_quotes':len(rows(summaries))}
  except Exception as exc:
   code=getattr(exc,'code',type(exc).__name__);blocked=blocked or code in ('http_403','http_451')
   states[symbol]={'status':'failed','received':0,'code':code}
 cutoff=datetime.now(timezone.utc)-timedelta(days=30)
 merged={(r['symbol'],r['expiry'],r['time']):r for r in previous.get('records',[]) if parse_time(r['time'])>=cutoff}
 merged.update({(r['symbol'],r['expiry'],r['time']):r for r in new})
 result={'attempted_at':now,'states':states,'snapshots':snapshots,'records':sorted(merged.values(),key=lambda r:(r['time'],r['symbol'],r['expiry']))}
 atomic_text(path,serialize(result));atomic_text(root/'options-data.js','window.OPTIONS_DATA = '+json.dumps(result,ensure_ascii=False,allow_nan=False)+';\n')
 return result

if __name__=='__main__':collect()
