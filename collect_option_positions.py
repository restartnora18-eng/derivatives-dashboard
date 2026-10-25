"""Complete current OKX option-chain OI aggregates, not volume or trader direction."""
import json,math,hashlib
from datetime import datetime,timezone,timedelta
from pathlib import Path
from collect_options import API,rows
from collect_funding import get_json,finite_number,timestamp_ms,parse_time,utc_now,atomic_text,serialize,DataError
ROOT=Path(__file__).resolve().parent

def aggregate(instruments,interest,symbol,now):
 live={}
 for i in rows(instruments):
  if i.get('instFamily')!=symbol+'-USD' or i.get('instType')!='OPTION' or i.get('state')!='live':continue
  expiry=timestamp_ms(i.get('expTime'))
  if not expiry or parse_time(expiry)<=parse_time(now):continue
  if i.get('settleCcy')!=symbol or i.get('ctValCcy')!=symbol or i.get('ctType')!='inverse' or i.get('optType') not in ('C','P'):raise DataError('contract_mismatch','期权单位或类型不匹配')
  val,mult,strike=[finite_number(i.get(k)) for k in ('ctVal','ctMult','stk')]
  if min(val,mult,strike)<=0:raise DataError('invalid_units','无效面值、乘数或执行价')
  if i['instId'] in live:raise DataError('duplicate_contract','重复合约')
  live[i['instId']]={**i,'expiry':expiry,'coin_per_contract':val*mult,'strike':strike}
 if not live:raise DataError('empty_chain','没有有效在市期权合约')
 byid={};ignored=0
 for r in rows(interest):
  name=r.get('instId')
  if name not in live:ignored+=1;continue
  if name in byid:raise DataError('duplicate_oi','重复持仓合约')
  if r.get('instType')!='OPTION':raise DataError('contract_mismatch','持仓类型不匹配')
  byid[name]=r
 if set(live)!=set(byid):raise DataError('incomplete_chain','当前在市合约持仓返回不完整，不补零')
 groups={};times=[];audit=[];units=set()
 for name,i in live.items():
  r=byid[name];oi=finite_number(r.get('oi'));coin=finite_number(r.get('oiCcy'));stamp=timestamp_ms(r.get('ts'))
  if oi<0 or coin<0 or not stamp:raise DataError('invalid_oi','持仓或来源时间无效')
  age=(parse_time(now)-parse_time(stamp)).total_seconds()
  if not -60<=age<=180:raise DataError('stale_oi','持仓来源时间过期')
  if not math.isclose(coin,oi*i['coin_per_contract'],rel_tol=1e-7,abs_tol=1e-8):raise DataError('unit_mismatch','oiCcy与张数、面值及乘数不一致')
  times.append(stamp);units.add(i['coin_per_contract']);audit.append([name,oi,coin,stamp])
  g=groups.setdefault(i['expiry'],{'expiry':i['expiry'],'call_coin':0.,'put_coin':0.,'call_contracts':0,'put_contracts':0})
  side='call' if i['optType']=='C' else 'put';g[side+'_coin']+=coin;g[side+'_contracts']+=1
 if (max(map(parse_time,times))-min(map(parse_time,times))).total_seconds()>120:raise DataError('time_skew','合约持仓来源时间差过大')
 result={'symbol':symbol,'family':symbol+'-USD','venue':'okx','time':max(times),'source_start':min(times),'fetched_at':now,'matched_contracts':len(live),'ignored_rows':ignored,'returned_rows':len(rows(interest)),'coin_per_contract_values':sorted(units),'expiries':sorted(groups.values(),key=lambda g:g['expiry']),'source_digest':hashlib.sha256(json.dumps(sorted(audit),separators=(',',':')).encode()).hexdigest()}
 result['call_coin']=sum(g['call_coin'] for g in groups.values());result['put_coin']=sum(g['put_coin'] for g in groups.values());result['pcr']=result['put_coin']/result['call_coin'] if result['call_coin']>0 else None
 for g in result['expiries']:g['pcr']=g['put_coin']/g['call_coin'] if g['call_coin']>0 else None
 return result

def collect(root=ROOT):
 root=Path(root);path=root/'data/option-positions/series.json';old=json.loads(path.read_text()) if path.exists() else {'snapshots':{},'records':[]};now=utc_now();snapshots=old.get('snapshots',{});states={};new=[];blocked=False
 for symbol in ('BTC','ETH'):
  try:
   if blocked:raise DataError('access_restricted','访问受限，跳过重复请求')
   params={'instType':'OPTION','instFamily':symbol+'-USD'}
   result=aggregate(get_json(API+'public/instruments',params),get_json(API+'public/open-interest',params),symbol,now)
   snapshots[symbol]=result;new.append({k:result[k] for k in ('symbol','time','fetched_at','call_coin','put_coin','pcr','matched_contracts')});states[symbol]={'status':'ok','matched_contracts':result['matched_contracts'],'returned_rows':result['returned_rows'],'ignored_rows':result['ignored_rows']}
  except Exception as exc:
   code=getattr(exc,'code',type(exc).__name__);blocked=blocked or code in ('http_403','http_451');states[symbol]={'status':'failed','code':code}
 cutoff=datetime.now(timezone.utc)-timedelta(days=30);merged={(r['symbol'],r['time']):r for r in old.get('records',[]) if parse_time(r['time'])>=cutoff};merged.update({(r['symbol'],r['time']):r for r in new})
 result={'attempted_at':now,'states':states,'snapshots':snapshots,'records':sorted(merged.values(),key=lambda r:(r['time'],r['symbol']))};atomic_text(path,serialize(result));atomic_text(root/'option-positions-data.js','window.OPTION_POSITIONS_DATA = '+json.dumps(result,ensure_ascii=False,allow_nan=False)+';\n');return result
if __name__=='__main__':collect()
