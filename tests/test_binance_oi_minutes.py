import json
import tempfile
import unittest
from pathlib import Path
import collect_binance_oi_minutes as m
from collect_funding import DataError

NOW = '2026-10-27T12:00:00.000Z'
END = int(m.parse_time(NOW).timestamp() * 1000)
MS = END - 3 * m.STEP


def oi(ms=MS, coin='10', usd='800000'):
    return {'symbol': 'BTCUSDT', 'timestamp': ms, 'sumOpenInterest': coin, 'sumOpenInterestValue': usd}


class BinanceMinuteTests(unittest.TestCase):
    def test_preserves_exchange_timestamp_and_btc_and_usd_fields(self):
        r = m.normalize(oi(MS + 123), 'oi', NOW)
        self.assertEqual(r, {'time': m.timestamp_ms(MS + 123), 'coin': 10, 'usd': 800000})
        self.assertNotIn('contracts', r)
        self.assertEqual(m.normalize(oi(coin='0', usd='0'), 'oi', NOW)['coin'], 0)

    def test_invalid_or_future_oi_never_accepted(self):
        for row in [oi(END + 1), oi(coin='NaN'), oi(coin='-1'), dict(oi(), symbol='ETHUSDT')]:
            with self.assertRaises(DataError):
                m.normalize(row, 'oi', NOW)

    def test_completed_mark_candles_only_and_correct_close_boundary(self):
        row = [MS, '80000', '81000', '79000', '80500', '0', MS + m.STEP - 1]
        r = m.normalize(row, 'prices', NOW)
        self.assertEqual(r['time'], m.timestamp_ms(MS + m.STEP))
        self.assertEqual(r['price'], 80500)
        self.assertEqual(r['opened_at'], m.timestamp_ms(MS))
        live = [END, *row[1:6], END + m.STEP - 1]
        self.assertIsNone(m.normalize(live, 'prices', NOW))
        with self.assertRaises(DataError):
            m.normalize([MS, '80000', '70000', '79000', '80500', '0', MS + m.STEP - 1], 'prices', NOW)

    def test_oi_pages_backwards_from_newest_500_not_forwards_like_candles(self):
        first = END - 1000 * m.STEP
        calls = []
        def request(url, params):
            calls.append(dict(params))
            return [oi(first + (i + 500) * m.STEP) for i in range(500)] if len(calls) == 1 else [oi(first + 499 * m.STEP)]
        rows, state = m.fetch('oi', [], NOW, request, lambda _: None)
        self.assertEqual(len(rows), 501)
        self.assertEqual(state['status'], 'ok')
        self.assertEqual(calls[1]['endTime'], first + 500 * m.STEP - 1)
        self.assertTrue(state['backfill_finished'])
        self.assertEqual(calls[0]['period'], '5m')

    def test_empty_and_http_failures_are_not_success(self):
        self.assertEqual(m.fetch('oi', [], NOW, lambda *_: [])[1]['code'], 'no_data')
        def denied(*_):
            raise DataError('http_451', 'Restricted')
        self.assertEqual(m.fetch('oi', [], NOW, denied)[1]['code'], 'http_451')

    def test_failure_retains_original_records_and_never_imports_okx(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / 'data/binance-oi-minutes/series.json'
            path.parent.mkdir(parents=True)
            record = m.normalize(oi(), 'oi', NOW)
            path.write_text(json.dumps({'venue': 'binance', 'contract': 'BTCUSDT', 'records': [record]}))
            result = m.collect(root, lambda *_: [], NOW)
            self.assertEqual(result['records'], [record])
            self.assertEqual(result['records'][0]['time'], record['time'])
            self.assertEqual(result['states']['oi']['status'], 'failed')
            self.assertEqual(json.loads((root / 'binance-oi-minutes.json').read_text()), result)
            path.write_text(json.dumps({'venue': 'okx', 'contract': 'BTC-USDT-SWAP', 'records': [record]}))
            self.assertEqual(m.collect(root, lambda *_: [], NOW)['records'], [])
