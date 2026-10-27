"""Five-minute OKX liquidation samples and completed mark-price candle history."""
import json
import time
from datetime import timedelta
from pathlib import Path
import collect_liquidations
from collect_funding import DataError, get_json, parse_time, utc_now, atomic_text, serialize
from collect_oi_minutes import normalize as normalize_candle

ROOT = Path(__file__).resolve().parent
ENDPOINT = 'https://www.okx.com/api/v5/market/history-mark-price-candles'


def fetch_prices(symbol, prior, now, request=None, pause=time.sleep):
    request = request or get_json
    cutoff = parse_time(now) - timedelta(days=1)
    latest = max((parse_time(r['time']) for r in prior if r['symbol'] == symbol), default=cutoff)
    stop = max(cutoff, latest - timedelta(minutes=5))
    params = {'instId': symbol + '-USDT-SWAP', 'bar': '5m', 'limit': '100'}
    accepted, pages, rejected, oldest, error, done = {}, 0, 0, None, None, False
    for _ in range(5):
        try:
            payload = request(ENDPOINT, params)
            pages += 1
            if str(payload.get('code')) != '0' or not isinstance(payload.get('data'), list):
                raise DataError('api_error', 'Invalid OKX history response')
            raw = payload['data']
            if not raw:
                done = True
                break
            stamps = []
            for row in raw:
                try:
                    item = normalize_candle(row, 'prices', now)
                    stamps.append(int(row[0]))
                    if item and parse_time(item['time']) >= cutoff:
                        item.update(symbol=symbol, contract=symbol + '-USDT-SWAP', venue='okx', interval_minutes=5)
                        accepted[item['time']] = item
                except (DataError, ValueError, TypeError, IndexError):
                    rejected += 1
            if not stamps:
                raise DataError('no_valid_times', 'No valid candle timestamps')
            cursor = min(stamps)
            if oldest is not None and cursor >= oldest:
                raise DataError('pagination_stalled', 'History cursor did not advance')
            oldest = cursor
            if parse_time(normalize_time(cursor)) <= stop or len(raw) < 100:
                done = True
                break
            params['after'] = str(cursor - 1)
            pause(.15)
        except Exception as exc:
            error = getattr(exc, 'code', type(exc).__name__)
            break
    if not done and not error:
        error = 'page_limit'
    if not accepted and not error:
        error = 'no_data'
    state = {'status': 'partial' if accepted and (error or rejected) else 'failed' if error else 'ok',
             'pages': pages, 'received': len(accepted), 'rejected': rejected}
    if error:
        state['code'] = error
    return list(accepted.values()), state


def normalize_time(ms):
    from collect_funding import timestamp_ms
    return timestamp_ms(ms)


def collect(root=ROOT, request=None, now=None):
    root, now = Path(root), now or utc_now()
    liquidation_data = collect_liquidations.collect(root)
    path = root / 'data/liquidation-prices/series.json'
    old = json.loads(path.read_text()) if path.exists() else {'records': []}
    cutoff = parse_time(now) - timedelta(days=30)
    merged = {(r['symbol'], r['time']): r for r in old['records'] if cutoff <= parse_time(r['time']) <= parse_time(now)}
    states = {}
    for symbol in ('BTC', 'ETH'):
        rows, state = fetch_prices(symbol, list(merged.values()), now, request)
        merged.update({(symbol, r['time']): r for r in rows})
        states[symbol] = state
    prices = {'venue': 'okx', 'interval_minutes': 5, 'endpoint': ENDPOINT, 'attempted_at': now,
              'records': sorted(merged.values(), key=lambda r: (r['time'], r['symbol']))[-17282:], 'states': states}
    atomic_text(path, serialize(prices))
    bundle = {'schema_version': 1, 'venue': 'okx', 'interval_minutes': 5,
              'liquidations': liquidation_data, 'prices': prices}
    atomic_text(root / 'liquidation-minutes.json', serialize(bundle))
    return bundle


if __name__ == '__main__':
    result = collect()
    print(json.dumps({key: result[key]['states'] for key in ('liquidations', 'prices')}))
