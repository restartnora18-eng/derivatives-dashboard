"""Binance BTCUSDT perpetual public 5m OI and completed mark candles.

Raw timestamps remain UTC. Browser formatting uses Asia/Shanghai.
No credentials, trading endpoints, venue substitution or interpolation.
"""
import json
import time
from datetime import timedelta
from pathlib import Path
from collect_funding import (DataError, atomic_text, finite_number, get_json,
                             parse_time, serialize, timestamp_ms, utc_now)

ROOT = Path(__file__).resolve().parent
BASE = 'https://fapi.binance.com'
CONTRACT = 'BTCUSDT'
STEP = 300000
PATHS = {'oi': '/futures/data/openInterestHist', 'prices': '/fapi/v1/markPriceKlines'}


def normalize(row, kind, now):
    current = int(parse_time(now).timestamp() * 1000)
    if kind == 'oi':
        if not isinstance(row, dict) or row.get('symbol') != CONTRACT:
            raise DataError('wrong_contract', 'Expected Binance BTCUSDT')
        raw_time = finite_number(row.get('timestamp'))
        ms = int(raw_time)
        coin = finite_number(row.get('sumOpenInterest'))
        usd = finite_number(row.get('sumOpenInterestValue'))
        if coin < 0 or usd < 0:
            raise DataError('negative_oi', 'Negative open interest')
        result = {'time': timestamp_ms(ms), 'coin': coin, 'usd': usd}
    else:
        if not isinstance(row, list) or len(row) < 7:
            raise DataError('invalid_candle', 'Missing mark candle fields')
        raw_time = finite_number(row[0])
        ms = int(raw_time)
        close_time = finite_number(row[6])
        if ms % STEP or close_time != ms + STEP - 1:
            raise DataError('invalid_candle_time', 'Not an exact 5m mark candle')
        values = {k: finite_number(v) for k, v in zip(('open', 'high', 'low', 'close'), row[1:5])}
        if any(v <= 0 for v in values.values()) or not (values['low'] <= min(values['open'], values['close']) <= max(values['open'], values['close']) <= values['high']):
            raise DataError('invalid_price', 'Invalid OHLC values')
        if ms + STEP > current:
            return None
        result = dict(values, time=timestamp_ms(ms + STEP), opened_at=timestamp_ms(ms), price=values['close'])
    if raw_time != ms or not timestamp_ms(ms) or ms > current:
        raise DataError('invalid_time', 'Invalid or future source timestamp')
    return result


def fetch(kind, old, now, request=None, pause=time.sleep, previous_state=None):
    request = request or get_json
    end = int(parse_time(now).timestamp() * 1000)
    cutoff = end - 5 * 86400000
    latest = max((int(parse_time(r['time']).timestamp() * 1000) for r in old), default=cutoff)
    previous_state = previous_state or {}
    start = max(cutoff, latest - STEP) if previous_state.get('backfill_finished') else cutoff
    cursor, page_end = start, end
    accepted, rejected, pages, error, finished = {}, 0, 0, None, False
    for _ in range(6):
        params = {'symbol': CONTRACT, 'limit': 500, 'startTime': cursor, 'endTime': page_end,
                  ('period' if kind == 'oi' else 'interval'): '5m'}
        try:
            raw = request(BASE + PATHS[kind], params)
            pages += 1
            if not isinstance(raw, list):
                raise DataError('api_error', 'Binance did not return a record list')
            if not raw:
                finished = True
                break
            stamps = []
            for row in raw:
                try:
                    item = normalize(row, kind, now)
                    stamp = int(finite_number(row['timestamp'] if kind == 'oi' else row[0]))
                    if cursor <= stamp <= page_end:
                        stamps.append(stamp)
                        if item is not None:
                            accepted[item['time']] = item
                    else:
                        rejected += 1
                except (DataError, ValueError, TypeError, KeyError, OverflowError):
                    rejected += 1
            if not stamps:
                raise DataError('pagination_stalled', 'No source timestamps in the requested window')
            # OI returns the newest 500 in a window; mark candles return the oldest.
            # Page each endpoint in its own direction, preserving source timestamps.
            next_cursor = max(stamps) + 1
            next_end = min(stamps) - 1
            if len(raw) < 500 or (next_end < cursor if kind == 'oi' else next_cursor > page_end):
                finished = True
                break
            if kind == 'oi':
                if next_end >= page_end:
                    raise DataError('pagination_stalled', 'OI pagination made no progress')
                page_end = next_end
            else:
                if next_cursor <= cursor:
                    raise DataError('pagination_stalled', 'Candle pagination made no progress')
                cursor = next_cursor
            pause(.15)
        except Exception as exc:
            error = getattr(exc, 'code', type(exc).__name__)
            break
    if not finished and not error:
        error = 'page_limit'
    if not accepted and not error:
        error = 'no_data'
    state = {'status': 'partial' if accepted and (error or rejected) else 'failed' if error else 'ok',
             'pages': pages, 'received': len(accepted), 'rejected': rejected,
             'backfill_finished': bool(previous_state.get('backfill_finished') or (finished and not error and not rejected))}
    if error:
        state['code'] = str(error)
    return list(accepted.values()), state


def collect(root=ROOT, request=None, now=None):
    root, now = Path(root), now or utc_now()
    path = root / 'data/binance-oi-minutes/series.json'
    old = json.loads(path.read_text()) if path.exists() else {}
    # Keep each venue separate. Never relabel OKX history as Binance.
    if old.get('venue') != 'binance' or old.get('contract') != CONTRACT:
        old = {}
    out = {'schema_version': 1, 'symbol': 'BTC', 'contract': CONTRACT, 'venue': 'binance',
           'interval_minutes': 5, 'attempted_at': now, 'sources': {k: BASE + v for k, v in PATHS.items()}, 'states': {}}
    cutoff = parse_time(now) - timedelta(days=30)
    for kind, key in (('oi', 'records'), ('prices', 'prices')):
        prior = old.get(key, [])
        fresh, state = fetch(kind, prior, now, request=request, previous_state=old.get('states', {}).get(kind, {}))
        merged = {r['time']: r for r in prior if cutoff <= parse_time(r['time']) <= parse_time(now)}
        merged.update({r['time']: r for r in fresh})
        out[key] = sorted(merged.values(), key=lambda r: r['time'])[-8641:]
        state['latest_at'] = out[key][-1]['time'] if out[key] else None
        out['states'][kind] = state
    atomic_text(path, serialize(out))
    atomic_text(root / 'binance-oi-minutes.json', serialize(out))
    return out


if __name__ == '__main__':
    result = collect()
    print(json.dumps({'attempted_at': result['attempted_at'], 'states': result['states']}))
