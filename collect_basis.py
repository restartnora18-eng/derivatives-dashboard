"""Compare same-run perpetual mark and USDT index; no expiry annualization."""
import json
from datetime import datetime, timezone, timedelta
from pathlib import Path
from collect_funding import get_json, finite_number, timestamp_ms, parse_time, utc_now, atomic_text, serialize, DataError
ROOT=Path(__file__).resolve().parent
ENDPOINT='https://www.okx.com/api/v5/market/index-tickers'

def normalize(payload, mark, symbol, now):
    if mark.get('contract')!=symbol+'-USDT-SWAP' or mark.get('venue')!='okx':
        raise DataError('contract_mismatch','标记价格合约不匹配')
    if str(payload.get('code'))!='0':raise DataError('api_error','指数接口返回错误状态')
    rows=[r for r in payload.get('data',[]) if r.get('instId')==symbol+'-USDT']
    if len(rows)!=1:raise DataError('index_mismatch','USDT 指数缺失或重复')
    row=rows[0];index=finite_number(row.get('idxPx'));price=finite_number(mark.get('price'));stamp=timestamp_ms(row.get('ts'))
    if index<=0 or price<=0:raise DataError('invalid_price','价格必须为正')
    if not stamp or not mark.get('time'):raise DataError('invalid_time','价格时间缺失')
    for t in [stamp,mark['time']]:
        if not -60 <= (parse_time(now)-parse_time(t)).total_seconds() <= 180:
            raise DataError('stale_pair','配对价格超过 3 分钟或时间无效')
    skew=abs((parse_time(stamp)-parse_time(mark['time'])).total_seconds())
    if skew>120:raise DataError('time_skew','两项价格时间差超过 120 秒')
    return {'symbol':symbol,'contract':symbol+'-USDT-SWAP','venue':'okx','index_id':symbol+'-USDT',
            'mark':price,'index':index,'spread':price-index,'premium_pct':(price/index-1)*100,
            'time':max(stamp,mark['time']),'mark_time':mark['time'],'index_time':stamp,'skew_seconds':skew,'fetched_at':now}

def collect(root=ROOT):
    root=Path(root);path=root/'data/basis/series.json';price_path=root/'data/price/series.json'
    previous=json.loads(path.read_text()) if path.exists() else {'records':[]}
    prices=json.loads(price_path.read_text()) if price_path.exists() else {'records':[],'states':{}}
    now=utc_now();states={};records=[];raw={};blocked=False
    for symbol in ('BTC','ETH'):
        try:
            if prices.get('states',{}).get(symbol,{}).get('status')!='ok':raise DataError('mark_unavailable','本次标记价格采集失败，未配对旧价格')
            marks=[r for r in prices['records'] if r['symbol']==symbol and r.get('fetched_at')==prices.get('attempted_at')]
            if not marks:raise DataError('mark_unavailable','缺少本次标记价格')
            mark=max(marks,key=lambda r:r['time'])
            if blocked:raise DataError('access_restricted','访问受限，跳过重复请求')
            p=get_json(ENDPOINT,{'instId':symbol+'-USDT'});raw[symbol]=p
            records.append(normalize(p,mark,symbol,now));states[symbol]={'status':'ok'}
        except Exception as exc:
            code=getattr(exc,'code',type(exc).__name__);blocked=blocked or code in ('http_403','http_451')
            states[symbol]={'status':'failed','code':code}
    cutoff=datetime.now(timezone.utc)-timedelta(days=30)
    merged={(r['contract'],r['mark_time'],r['index_time']):r for r in previous.get('records',[]) if parse_time(r['time'])>=cutoff}
    merged.update({(r['contract'],r['mark_time'],r['index_time']):r for r in records})
    result={'attempted_at':now,'index_endpoint':ENDPOINT,'mark_endpoint':'https://www.okx.com/api/v5/public/mark-price','states':states,'records':sorted(merged.values(),key=lambda r:(r['time'],r['contract']))}
    atomic_text(root/'data/basis/last-attempt.json',serialize({'attempted_at':now,'states':states,'raw':raw}))
    atomic_text(path,serialize(result))
    atomic_text(root/'basis-data.js','window.BASIS_DATA = '+json.dumps(result,ensure_ascii=False,allow_nan=False)+';\n')
    return result

if __name__=='__main__':collect()
