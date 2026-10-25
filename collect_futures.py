"""Small expiry-futures basis collector. Public GETs, up to four expiries per asset."""
import json
from datetime import datetime, timezone, timedelta
from pathlib import Path
from collect_funding import get_json, finite_number, timestamp_ms, parse_time, utc_now, atomic_text, serialize, DataError
ROOT=Path(__file__).resolve().parent
API='https://www.okx.com/api/v5/'

def rows(payload):
    if str(payload.get('code'))!='0' or not isinstance(payload.get('data'),list):
        raise DataError('api_error','接口状态或数据结构无效')
    return payload['data']

def select_contracts(payload,symbol,now):
    selected={}
    for r in rows(payload):
        expiry=timestamp_ms(r.get('expTime'))
        if (r.get('instType')=='FUTURES' and r.get('instFamily')==symbol+'-USDT'
            and r.get('settleCcy')=='USDT' and r.get('ctType')=='linear' and r.get('state')=='live'
            and expiry and parse_time(expiry)>parse_time(now)):
            selected[r['instId']]=dict(r,expiry=expiry)
    return sorted(selected.values(),key=lambda r:r['expiry'])[:4]

def normalize(instrument,mark,index,symbol,now):
    if mark.get('instId')!=instrument['instId'] or mark.get('instType')!='FUTURES' or index.get('instId')!=symbol+'-USDT':
        raise DataError('contract_mismatch','合约或指数不匹配')
    price=finite_number(mark.get('markPx'));spot=finite_number(index.get('idxPx'))
    if price<=0 or spot<=0:raise DataError('invalid_price','价格必须为正')
    mt=timestamp_ms(mark.get('ts'));it=timestamp_ms(index.get('ts'))
    if not mt or not it:raise DataError('invalid_time','来源时间缺失')
    for t in (mt,it):
        if not -60<=(parse_time(now)-parse_time(t)).total_seconds()<=180:
            raise DataError('stale_pair','配对价格过期')
    skew=abs((parse_time(mt)-parse_time(it)).total_seconds())
    if skew>120:raise DataError('time_skew','价格时间差超过 120 秒')
    observed=max(mt,it);days=(parse_time(instrument['expiry'])-parse_time(observed)).total_seconds()/86400
    if days<=0:raise DataError('expired','合约已到期')
    premium=(price/spot-1)*100
    return {'symbol':symbol,'contract':instrument['instId'],'venue':'okx','expiry':instrument['expiry'],
            'time':observed,'mark_time':mt,'index_time':it,'fetched_at':now,'skew_seconds':skew,
            'mark':price,'index':spot,'spread':price-spot,'basis_pct':premium,'days_remaining':days,
            'annualized_pct':premium*365/days if days>=1 else None,'near_expiry':days<1}

def collect(root=ROOT):
    root=Path(root);path=root/'data/futures/series.json'
    previous=json.loads(path.read_text()) if path.exists() else {'records':[],'snapshots':{}}
    now=utc_now();states={};new=[];raw={};snapshots=previous.get('snapshots',{});blocked=False
    for symbol in ('BTC','ETH'):
        errors=[];received=[]
        try:
            if blocked:raise DataError('access_restricted','访问受限，跳过重复请求')
            instruments=get_json(API+'public/instruments',{'instType':'FUTURES','instFamily':symbol+'-USDT'})
            raw[symbol]={'instruments':instruments}
            contracts=select_contracts(instruments,symbol,now)
            if not contracts:raise DataError('no_contracts','暂无符合口径的未到期 USDT 交割合约')
            marks_payload=get_json(API+'public/mark-price',{'instType':'FUTURES','instFamily':symbol+'-USDT'})
            raw[symbol]['marks']=marks_payload;marks=rows(marks_payload)
            index_payload=get_json(API+'market/index-tickers',{'instId':symbol+'-USDT'})
            raw[symbol]['index']=index_payload;indices=[r for r in rows(index_payload) if r.get('instId')==symbol+'-USDT']
            if len(indices)!=1:raise DataError('index_mismatch','指数缺失或重复')
            for instrument in contracts:
                try:
                    match=[r for r in marks if r.get('instId')==instrument['instId']]
                    if len(match)!=1:raise DataError('mark_missing','标记价格缺失或重复')
                    received.append(normalize(instrument,match[0],indices[0],symbol,now))
                except Exception as exc:errors.append({'contract':instrument['instId'],'code':getattr(exc,'code',type(exc).__name__)})
            if received:snapshots[symbol]={'captured_at':now,'records':received};new.extend(received)
            states[symbol]={'status':'ok' if len(received)==len(contracts) else 'partial' if received else 'failed','received':len(received),'expected':len(contracts),'errors':errors}
        except Exception as exc:
            code=getattr(exc,'code',type(exc).__name__);blocked=blocked or code in ('http_403','http_451')
            states[symbol]={'status':'failed','received':0,'errors':[{'code':code}]}
    cutoff=datetime.now(timezone.utc)-timedelta(days=30)
    merged={(r['contract'],r['mark_time'],r['index_time']):r for r in previous.get('records',[]) if parse_time(r['time'])>=cutoff}
    merged.update({(r['contract'],r['mark_time'],r['index_time']):r for r in new})
    result={'attempted_at':now,'states':states,'snapshots':snapshots,'records':sorted(merged.values(),key=lambda r:(r['time'],r['contract']))}
    atomic_text(root/'data/futures/last-attempt.json',serialize({'attempted_at':now,'states':states,'raw':raw}))
    atomic_text(path,serialize(result));atomic_text(root/'futures-data.js','window.FUTURES_DATA = '+json.dumps(result,ensure_ascii=False,allow_nan=False)+';\n')
    return result

if __name__=='__main__':collect()
