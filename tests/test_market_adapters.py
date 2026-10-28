import json
import tempfile
import unittest
from pathlib import Path

from collect_funding import DataError
from market_adapters import AdapterError, ReadOnlyAdapter, load_config
from market_adapters.probe import compare

NOW = 1793156400000
PAST = NOW - 300000
MARKET = {'id': 'BTC-USDT-SWAP', 'linear': True, 'swap': True, 'base': 'BTC', 'settle': 'USDT', 'contractSize': .01}
NATIVE_MARKET = {'instId': 'BTC-USDT-SWAP', 'ctType': 'linear', 'ctValCcy': 'BTC', 'settleCcy': 'USDT', 'ctVal': '.01', 'ctMult': '1'}


def native_request(url, params):
    if url.endswith('/instruments'):
        return {'code': '0', 'data': [NATIVE_MARKET]}
    if url.endswith('/open-interest-history'):
        return {'code': '0', 'data': [[str(PAST), '100', '1', '80000']]}
    if url.endswith('/history-mark-price-candles'):
        return {'code': '0', 'data': [[str(PAST), '80000', '81000', '79000', '80500', '1'], [str(NOW), '80000', '81000', '79000', '80500', '0']]}
    if url.endswith('/trades'):
        return {'code': '0', 'data': [{'instId': 'BTC-USDT-SWAP', 'ts': str(PAST), 'px': '80000', 'sz': '2', 'side': 'buy', 'tradeId': 'abc'}]}
    return {'code': '0', 'data': [[str(PAST), '1.5']]}


class SDK:
    def __init__(self):
        self.transported = []
        self.loads = 0

    def fetch(self, url, method='GET', headers=None, body=None):
        self.transported.append((url, method))
        return {}

    def load_markets(self):
        self.loads += 1
        self.fetch('https://www.okx.com/api/v5/public/instruments?instType=SWAP')

    def market(self, symbol):
        return MARKET

    def fetch_open_interest_history(self, symbol, timeframe, limit):
        self.fetch('https://www.okx.com/api/v5/rubik/stat/contracts/open-interest-history?instId=BTC-USDT-SWAP')
        return [{'symbol': symbol, 'timestamp': PAST, 'openInterestAmount': 100, 'baseVolume': 1, 'openInterestValue': 80000}]

    def fetch_mark_ohlcv(self, symbol, timeframe, limit):
        return [[PAST, 80000, 81000, 79000, 80500, 0], [NOW, 80000, 81000, 79000, 80500, 0]]

    def fetch_trades(self, symbol, limit):
        return [{'symbol': symbol, 'timestamp': PAST, 'price': 80000, 'amount': 2, 'side': 'buy', 'id': 'abc'}]


class ReadOnlyTests(unittest.TestCase):
    def native(self, request=native_request):
        return ReadOnlyAdapter(request=request, clock=lambda: NOW)

    def sdk(self, sdk=None):
        sdk = sdk or SDK()
        return ReadOnlyAdapter(provider='ccxt', sdk_factory=lambda: sdk, clock=lambda: NOW), sdk

    def test_default_is_native_and_native_mode_never_constructs_sdk(self):
        def forbidden():
            self.fail('CCXT must be lazy and optional')
        adapter = ReadOnlyAdapter(request=native_request, sdk_factory=forbidden, clock=lambda: NOW)
        result = adapter.read('long_short_ratio')
        self.assertEqual(result['provider'], 'native')
        self.assertEqual(result['records'][0]['long_short_account_ratio'], 1.5)
        self.assertFalse(result['fallback_used'])

    def test_oi_units_and_timestamps_match_across_providers(self):
        native = self.native().read('oi_history')
        adapter, sdk = self.sdk()
        other = adapter.read('oi_history')
        self.assertEqual(native['records'], other['records'])
        record = other['records'][0]
        self.assertEqual(record['open_interest_base'], 1)
        self.assertEqual(record['open_interest_contracts'], 100)
        self.assertEqual(record['open_interest_value_currency'], 'USD')
        self.assertEqual(record['timestamp'], PAST)
        adapter.read('oi_history')
        self.assertEqual(sdk.loads, 1)

    def test_only_closed_mark_candles_reach_either_provider_output(self):
        for adapter in [self.native(), self.sdk()[0]]:
            result = adapter.read('mark_candles')
            self.assertEqual(len(result['records']), 1)
            self.assertEqual(result['records'][0]['opened_at_ms'], PAST)
            self.assertEqual(result['records'][0]['timestamp'], NOW)
            self.assertEqual(result['quality']['unfinished_candles_skipped'], 1)

    def test_trade_contracts_are_converted_to_base_once(self):
        a, b = self.native().read('trades'), self.sdk()[0].read('trades')
        self.assertEqual(a['records'], b['records'])
        self.assertEqual(a['records'][0]['amount_base'], .02)
        self.assertEqual(a['records'][0]['amount_contracts'], 2)

    def test_binance_uses_recent_trades_not_ccxt_default_aggregates(self):
        sdk = SDK()
        sdk.market = lambda symbol: dict(MARKET, id='BTCUSDT', contractSize=1)
        sdk.load_markets = lambda: None
        captured = []
        def recent(symbol, limit, params):
            captured.append(params)
            return [{'symbol':symbol,'timestamp':PAST,'price':80000,'amount':.02,'side':'sell','id':'1'}]
        sdk.fetch_trades = recent
        adapter = ReadOnlyAdapter(provider='ccxt', exchange='binance', sdk_factory=lambda:sdk, clock=lambda:NOW)
        r = adapter.read('trades')
        self.assertEqual(captured, [{'fetchTradesMethod':'fapiPublicGetTrades'}])
        self.assertEqual(r['records'][0]['amount_base'], .02)

    def test_invalid_conversion_and_future_data_are_not_usable(self):
        for row in [[str(PAST), '100', '999', '80000'], [str(NOW+1), '100', '1', '80000'], [str(PAST), 'NaN', '1', '80000'], [str(PAST+.5), '100', '1', '80000']]:
            def request(url, params):
                return native_request(url, params) if url.endswith('/instruments') else {'code':'0','data':[row]}
            r = self.native(request).read('oi_history')
            self.assertEqual(r['records'], [])
            self.assertEqual(r['status'], 'failed')
            self.assertEqual(r['quality']['rejected'], 1)

    def test_public_get_guard_blocks_private_paths_hosts_writes_and_credentials(self):
        adapter = self.native()
        unsafe = [
            ('https://www.okx.com/api/v5/trade/order', 'GET', None, None),
            ('https://www.okx.com/api/v5/public/instruments', 'POST', None, None),
            ('https://example.com/api/v5/public/instruments', 'GET', None, None),
            ('http://www.okx.com/api/v5/public/instruments', 'GET', None, None),
            ('https://www.okx.com/api/v5/public/instruments?apiKey=', 'GET', None, None),
            ('https://user:pass@www.okx.com/api/v5/public/instruments', 'GET', None, None),
            ('https://www.okx.com/api/v5/public/instruments', 'GET', {'OK-ACCESS-KEY':'secret'}, None),
            ('https://www.okx.com/api/v5/public/instruments', 'GET', None, '{}'),
        ]
        for args in unsafe:
            with self.assertRaises(AdapterError) as ctx:
                adapter._guard(*args)
            self.assertEqual(ctx.exception.code, 'read_only_violation')

    def test_sdk_transport_cannot_send_order_requests(self):
        sdk = SDK()
        def unsafe(*args, **kwargs):
            sdk.fetch('https://www.okx.com/api/v5/trade/order', 'POST', body='{}')
        sdk.fetch_trades = unsafe
        adapter, _ = self.sdk(sdk)
        with self.assertRaises(AdapterError) as ctx:
            adapter.read('trades')
        self.assertEqual(ctx.exception.code, 'read_only_violation')
        self.assertEqual(len(sdk.transported), 1)  # Only public metadata was sent.

    def test_failure_is_explicit_and_does_not_fallback(self):
        def denied(*_):
            raise DataError('http_451', 'Restricted')
        with self.assertRaises(AdapterError) as ctx:
            self.native(denied).read('oi_history')
        self.assertEqual(ctx.exception.code, 'http_451')

    def test_configuration_rejects_credentials_and_unsupported_markets(self):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory)/'source.json'
            p.write_text(json.dumps({'provider':'ccxt','apiKey':'never-accepted'}))
            with self.assertRaises(AdapterError):
                load_config(p)
        for config in [{'provider':'private'}, {'symbol':'BTC/USDT'}, {'exchange':'unknown'}, {'timeframe':'1m'}, {'limit':True}]:
            with self.assertRaises(AdapterError):
                ReadOnlyAdapter(**config)
        with self.assertRaises(AdapterError):
            self.native().read('create_order')

    def test_compare_preserves_separate_sources_and_aligns_only_shared_records(self):
        a, b = self.native().read('oi_history'), self.sdk()[0].read('oi_history')
        result = compare(a, b)
        self.assertTrue(result['comparable'])
        self.assertEqual(result['shared_records'], 1)
        self.assertEqual(result['differences'], [])
        self.assertFalse(compare(a, {'error':{'code':'http_451'}})['comparable'])
        self.assertFalse(compare(a, dict(b, exchange='binance'))['comparable'])
        trades_a, trades_b = self.native().read('trades'), self.sdk()[0].read('trades')
        trades_b['records'][0]['timestamp'] += 1
        self.assertTrue(any(d['field'] == 'timestamp' for d in compare(trades_a, trades_b)['differences']))
