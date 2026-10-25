"""Hourly OKX USDT perpetual OI observations; no inferred historical backfill."""
import json
from datetime import datetime, timezone, timedelta
from pathlib import Path
from collect_funding import get_json, finite_number, timestamp_ms, parse_time, utc_now, atomic_text, serialize, DataError

ROOT = Path(__file__).resolve().parent
ENDPOINT = 'https://www.okx.com/api/v5/public/open-interest'


def normalize(payload, symbol, now):
    contract = symbol + '-USDT-SWAP'
    if str(payload.get('code')) != '0':
        raise DataError('api_error', 'OKX 返回错误状态')
    rows = [r for r in payload.get('data', []) if r.get('instId') == contract and r.get('instType') == 'SWAP']
    if len(rows) != 1:
        raise DataError('contract_mismatch', '合约缺失或重复')
    r = rows[0]
    stamp = timestamp_ms(r.get('ts'))
    if not stamp or not -60 <= (parse_time(now)-parse_time(stamp)).total_seconds() <= 5400:
        raise DataError('invalid_time', '接口时间无效或过期')
    values = {name: finite_number(r.get(field)) for name, field in [('contracts','oi'),('coin','oiCcy'),('usd','oiUsd')]}
    if any(v < 0 for v in values.values()):
        raise DataError('negative_oi', '持仓量不能为负数')
    return dict(values, symbol=symbol, contract=contract, venue='okx', time=stamp, fetched_at=now)


def collect(root=ROOT):
    root = Path(root)
    path = root / 'data/oi/series.json'
    previous = json.loads(path.read_text()) if path.exists() else {'records': []}
    now = utc_now()
    states, records, raw = {}, [], {}
    blocked = False
    for symbol in ('BTC','ETH'):
        try:
            if blocked:
                raise DataError('access_restricted', '同一交易所访问受限，跳过重复请求')
            payload = get_json(ENDPOINT, {'instType':'SWAP','instId':symbol+'-USDT-SWAP'})
            raw[symbol] = payload
            records.append(normalize(payload, symbol, now))
            states[symbol] = {'status':'ok'}
        except Exception as exc:
            code = getattr(exc, 'code', type(exc).__name__)
            blocked = blocked or code in ('http_403','http_451')
            states[symbol] = {'status':'failed', 'code':code}
    cutoff = datetime.now(timezone.utc)-timedelta(days=30)
    merged = {(r['contract'],r['time']):r for r in previous.get('records', []) if parse_time(r['time']) >= cutoff}
    merged.update({(r['contract'],r['time']):r for r in records})
    result = {'attempted_at':now, 'endpoint':ENDPOINT, 'states':states,
              'records':sorted(merged.values(), key=lambda r:(r['time'],r['contract']))}
    atomic_text(root/'data/oi/last-attempt.json', serialize({'attempted_at':now,'states':states,'raw':raw}))
    atomic_text(path, serialize(result))
    atomic_text(root/'oi-data.js', 'window.OI_DATA = '+json.dumps(result,ensure_ascii=False,allow_nan=False)+';\n')
    return result


if __name__ == '__main__':
    collect()
