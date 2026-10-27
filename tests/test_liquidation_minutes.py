import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import collect_liquidation_minutes as m
from collect_funding import DataError

NOW = '2026-10-27T12:00:00.000Z'
MS = int(m.parse_time(NOW).timestamp() * 1000) - 300000


def candle(ms=MS, confirm='1'):
    return [str(ms), '80000', '81000', '79000', '80500', confirm]


class LiquidationMinuteTests(unittest.TestCase):
    def test_closed_five_minute_prices_preserve_contract_and_real_close_boundary(self):
        rows, state = m.fetch_prices('BTC', [], NOW, lambda *_: {'code':'0','data':[candle(), candle(MS+300000,'0')]})
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['time'], NOW)
        self.assertEqual(rows[0]['opened_at'], m.normalize_time(MS))
        self.assertEqual(rows[0]['price'], 80500)
        self.assertEqual(rows[0]['contract'], 'BTC-USDT-SWAP')
        self.assertEqual(state['status'], 'ok')

    def test_backward_pagination_and_same_page_detection(self):
        raw = [candle(MS - i*300000) for i in range(100)]
        calls = []
        def req(url, params):
            calls.append(dict(params))
            return {'code':'0','data':raw if len(calls)==1 else [candle(MS-100*300000)]}
        rows, state = m.fetch_prices('ETH', [], NOW, req, lambda _:None)
        self.assertEqual(len(rows), 101)
        self.assertEqual(calls[1]['after'], str(MS-99*300000-1))
        self.assertEqual(state['status'], 'ok')
        _, failed = m.fetch_prices('BTC', [], NOW, lambda *_:{'code':'0','data':raw}, lambda _:None)
        self.assertEqual(failed['code'], 'pagination_stalled')

    def test_failed_refresh_retains_real_prices_and_sources_remain_separate(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            liq={'records':[], 'states':{'BTC':{'status':'ok'},'ETH':{'status':'ok'}}, 'attempted_at':NOW}
            with patch.object(m.collect_liquidations,'collect',return_value=liq):
                first=m.collect(root,lambda *_:{'code':'0','data':[candle()]},NOW)
                def denied(*_):raise DataError('http_403','Denied')
                second=m.collect(root,denied,NOW)
            self.assertEqual(first['prices']['records'],second['prices']['records'])
            self.assertEqual(second['prices']['states']['BTC']['status'],'failed')
            self.assertEqual(json.loads((root/'liquidation-minutes.json').read_text()),second)
            self.assertFalse((root/'price-data.js').exists())
