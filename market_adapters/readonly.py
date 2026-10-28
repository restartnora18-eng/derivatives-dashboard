"""Allowlisted public GET readers. No credentials or trading APIs accepted."""
from __future__ import annotations

import json
import math
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from collect_funding import get_json

PINNED_CCXT = '4.5.90'
OPERATIONS = ('oi_history', 'mark_candles', 'long_short_ratio', 'trades')
SYMBOLS = ('BTC/USDT:USDT', 'ETH/USDT:USDT')
PATHS = {
    'binance': {
        'markets': '/fapi/v1/exchangeInfo',
        'oi_history': '/futures/data/openInterestHist',
        'mark_candles': '/fapi/v1/markPriceKlines',
        'long_short_ratio': '/futures/data/globalLongShortAccountRatio',
        'trades': '/fapi/v1/trades',
    },
    'okx': {
        'markets': '/api/v5/public/instruments',
        'oi_history': '/api/v5/rubik/stat/contracts/open-interest-history',
        'mark_candles': '/api/v5/market/history-mark-price-candles',
        'current_mark_candles': '/api/v5/market/mark-price-candles',
        'long_short_ratio': '/api/v5/rubik/stat/contracts/long-short-account-ratio-contract',
        'trades': '/api/v5/market/trades',
    },
}
HOSTS = {'binance': 'fapi.binance.com', 'okx': 'www.okx.com'}
SDK_METHODS = {'oi_history': 'fetch_open_interest_history', 'mark_candles': 'fetch_mark_ohlcv',
               'long_short_ratio': 'fetch_long_short_ratio_history', 'trades': 'fetch_trades'}


class AdapterError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def stamp(ms):
    return datetime.fromtimestamp(ms / 1000, timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def numeric(value):
    if value is None or value == '' or isinstance(value, bool):
        raise ValueError('Missing number')
    n = float(value)
    if not math.isfinite(n):
        raise ValueError('Non-finite number')
    return n


def millis(value):
    n = numeric(value)
    if n != int(n) or n <= 0:
        raise ValueError('Invalid millisecond timestamp')
    return int(n)


def load_config(path):
    try:
        raw = json.loads(Path(path).read_text(encoding='utf-8'))
    except (OSError, ValueError):
        raise AdapterError('invalid_config', 'Cannot read a valid JSON source configuration.')
    allowed = {'provider', 'exchange', 'symbol', 'timeframe', 'limit'}
    if not isinstance(raw, dict) or set(raw) - allowed:
        raise AdapterError('invalid_config', 'Only public reader settings are accepted; no keys or credentials.')
    if raw.get('provider', 'native') not in ('native', 'ccxt'):
        raise AdapterError('invalid_config', 'The persistent provider must be native or ccxt; compare is an explicit run mode.')
    return raw


class ReadOnlyAdapter:
    def __init__(self, provider='native', exchange='okx', symbol='BTC/USDT:USDT',
                 timeframe='5m', limit=20, *, request=None, sdk_factory=None, clock=None):
        if provider not in ('native', 'ccxt') or exchange not in HOSTS or symbol not in SYMBOLS or timeframe != '5m':
            raise AdapterError('invalid_config', 'Supported: native/ccxt, Binance/OKX, BTC/ETH USDT perpetual, 5m.')
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 100:
            raise AdapterError('invalid_limit', 'Limit must be an integer from 1 to 100.')
        self.provider, self.exchange, self.symbol = provider, exchange, symbol
        self.base, self.timeframe, self.limit = symbol.split('/')[0], timeframe, limit
        self.contract = self.base + ('USDT' if exchange == 'binance' else '-USDT-SWAP')
        self._request, self._sdk_factory = request or get_json, sdk_factory
        self._clock = clock or (lambda: int(time.time() * 1000))
        self._sdk, self._market, self._endpoints = None, None, set()

    def _guard(self, url, method='GET', headers=None, body=None):
        u = urlsplit(url)
        forbidden_headers = {'authorization', 'x-mbx-apikey', 'ok-access-key', 'ok-access-sign'}
        forbidden_params = {'signature', 'apikey', 'api_key', 'secret', 'token'}
        if (method.upper() != 'GET' or body is not None or u.scheme != 'https' or u.hostname != HOSTS[self.exchange]
                or u.username or u.password or u.port not in (None, 443)
                or u.path not in PATHS[self.exchange].values()
                or forbidden_headers.intersection(k.lower() for k in (headers or {}))
                or forbidden_params.intersection(k.lower() for k in parse_qs(u.query, keep_blank_values=True))):
            raise AdapterError('read_only_violation', 'Only allowlisted public HTTPS GET endpoints are permitted.')
        self._endpoints.add(u.scheme + '://' + u.netloc + u.path)

    def _get(self, key, params):
        if any(str(k).lower() in {'apikey', 'api_key', 'signature', 'secret', 'token'} for k in params):
            raise AdapterError('read_only_violation', 'Credentials are not accepted.')
        url = 'https://' + HOSTS[self.exchange] + PATHS[self.exchange][key]
        self._guard(url)
        return self._request(url, params)

    def _client(self):
        if self._sdk is None:
            if self._sdk_factory:
                sdk = self._sdk_factory()
            else:
                try:
                    import ccxt
                except ImportError:
                    raise AdapterError('ccxt_not_installed', 'Install the optional market_adapters requirements in Python >=3.10.')
                if ccxt.__version__ != PINNED_CCXT:
                    raise AdapterError('ccxt_version_mismatch', 'This adapter is verified against CCXT ' + PINNED_CCXT)
                cls = ccxt.binanceusdm if self.exchange == 'binance' else ccxt.okx
                sdk = cls({'enableRateLimit': True, 'timeout': 8000, 'requests_trust_env': True,
                           'options': {'defaultType': 'swap', 'fetchMarkets': {'types': ['linear' if self.exchange == 'binance' else 'swap']}}})
            original = sdk.fetch
            def guarded_fetch(url, method='GET', headers=None, body=None):
                self._guard(url, method, headers, body)
                return original(url, method, headers, body)
            sdk.fetch = guarded_fetch
            sdk.load_markets()
            self._sdk = sdk
        return self._sdk

    def _metadata(self):
        if self._market is None:
            if self.provider == 'ccxt':
                m = self._client().market(self.symbol)
                if not (m.get('linear') and m.get('swap') and m.get('base') == self.base and m.get('settle') == 'USDT'):
                    raise AdapterError('wrong_market', 'Expected the selected linear USDT perpetual.')
                size = numeric(m.get('contractSize'))
            elif self.exchange == 'okx':
                p = self._get('markets', {'instType': 'SWAP', 'instId': self.contract})
                rows = self._rows(p)
                matches = [r for r in rows if r.get('instId') == self.contract]
                if len(matches) != 1:
                    raise AdapterError('wrong_market', 'Missing or duplicate contract metadata.')
                m = matches[0]
                if m.get('ctType') != 'linear' or m.get('ctValCcy') != self.base or m.get('settleCcy') != 'USDT':
                    raise AdapterError('wrong_market', 'Contract face value must be in the selected base currency.')
                size = numeric(m.get('ctVal')) * numeric(m.get('ctMult') or 1)
            else:
                size = 1.0  # BTC/ETH USD-M quantities are denominated in the base asset.
            if size <= 0:
                raise AdapterError('invalid_contract_size', 'Contract size must be positive.')
            self._market = {'contract_size_base': size, 'base': self.base, 'quote': 'USDT'}
        return self._market

    def _rows(self, payload):
        if self.exchange == 'okx':
            if not isinstance(payload, dict) or str(payload.get('code')) != '0' or not isinstance(payload.get('data'), list):
                raise AdapterError('api_error', 'OKX public API returned an invalid status or record list.')
            return payload['data']
        if not isinstance(payload, list):
            raise AdapterError('api_error', 'Binance public API did not return a record list.')
        return payload

    def _fetch(self, operation):
        if self.provider == 'ccxt':
            sdk = self._client()
            method = getattr(sdk, SDK_METHODS[operation])
            if operation == 'trades':
                if self.exchange == 'binance':
                    # CCXT otherwise defaults to aggregate trades. Keep both
                    # providers on the same public recent-trade endpoint.
                    return method(self.symbol, limit=self.limit, params={'fetchTradesMethod': 'fapiPublicGetTrades'})
                return method(self.symbol, limit=self.limit)
            return method(self.symbol, self.timeframe, limit=self.limit)
        if self.exchange == 'binance':
            params = {'symbol': self.contract, 'limit': self.limit}
            if operation != 'trades':
                params['interval' if operation == 'mark_candles' else 'period'] = self.timeframe
        else:
            params = {'instId': self.contract, 'limit': str(self.limit)}
            if operation != 'trades':
                params['bar' if operation == 'mark_candles' else 'period'] = self.timeframe
        return self._rows(self._get(operation, params))

    def read(self, operation):
        if operation not in OPERATIONS:
            raise AdapterError('unsupported_operation', 'Read-only operations: ' + ', '.join(OPERATIONS))
        requested = self._clock()
        self._endpoints = set()
        try:
            market = self._metadata()
            raw = self._fetch(operation)
        except AdapterError:
            raise
        except Exception as exc:
            raise AdapterError(getattr(exc, 'code', type(exc).__name__), 'Public data request failed: ' + type(exc).__name__) from exc
        now, records, rejected, unfinished = self._clock(), [], 0, 0
        if not isinstance(raw, list):
            raise AdapterError('api_error', 'Reader returned an invalid record list.')
        for item in raw:
            try:
                row = self._normalize(item, operation, market)
                if row.get('closed_at_ms', 0) > now or row.pop('_unconfirmed', False):
                    unfinished += 1
                    continue
                if not 0 < row['timestamp'] <= now:
                    raise ValueError('Invalid or future source time')
                row['time'] = stamp(row['timestamp'])
                records.append(row)
            except (KeyError, ValueError, TypeError, IndexError, OverflowError):
                rejected += 1
        key = (lambda r: r['id']) if operation == 'trades' else (lambda r: r['timestamp'])
        records = sorted({key(r): r for r in records}.values(), key=lambda r: r['timestamp'])[-self.limit:]
        return {'schema_version': 1, 'provider': self.provider, 'exchange': self.exchange,
                'symbol': self.symbol, 'contract': self.contract, 'operation': operation,
                'timeframe': self.timeframe, 'requested_at': stamp(requested), 'fetched_at': stamp(now),
                'status': 'partial' if rejected and records else 'failed' if rejected else 'ok' if records else 'empty',
                'records': records, 'quality': {'rejected': rejected, 'unfinished_candles_skipped': unfinished},
                'units': market, 'source_endpoints': sorted(self._endpoints), 'fallback_used': False}

    def _normalize(self, item, operation, market):
        sdk = self.provider == 'ccxt'
        if operation == 'mark_candles':
            ms = millis(item[0])
            values = [numeric(v) for v in item[1:5]]
            o, h, l, c = values
            if ms % 300000 or min(values) <= 0 or not l <= min(o, c) <= max(o, c) <= h:
                raise ValueError('Invalid mark candle')
            if not sdk and self.exchange == 'binance' and numeric(item[6]) != ms + 299999:
                raise ValueError('Invalid candle close time')
            return dict(timestamp=ms + 300000, opened_at_ms=ms, closed_at_ms=ms + 300000,
                        open=o, high=h, low=l, close=c,
                        _unconfirmed=not sdk and self.exchange == 'okx' and item[5] != '1')
        if operation == 'oi_history':
            if sdk:
                ms, amount, value = item['timestamp'], numeric(item['openInterestAmount']), numeric(item['openInterestValue'])
                if item.get('symbol') != self.symbol:
                    raise ValueError('Wrong contract')
            elif self.exchange == 'binance':
                if item.get('symbol') != self.contract:
                    raise ValueError('Wrong contract')
                ms, amount, value = item['timestamp'], numeric(item['sumOpenInterest']), numeric(item['sumOpenInterestValue'])
            else:
                ms, amount, value = item[0], numeric(item[1]), numeric(item[3])
            if min(amount, value) < 0:
                raise ValueError('Negative OI')
            base = amount * market['contract_size_base']
            supplied_base = item.get('baseVolume') if sdk else item[2] if self.exchange == 'okx' else None
            if supplied_base is not None and not math.isclose(base, numeric(supplied_base), rel_tol=1e-8, abs_tol=1e-10):
                raise ValueError('OI contract conversion disagrees with source quantity')
            return {'timestamp': millis(ms), 'open_interest_base': base, 'open_interest_value': value,
                    'open_interest_value_currency': 'USD' if self.exchange == 'okx' else 'USDT',
                    'open_interest_contracts': amount if self.exchange == 'okx' else None}
        if operation == 'long_short_ratio':
            if not sdk and self.exchange == 'okx' and isinstance(item, list):
                ms, ratio = item[0], numeric(item[1])
            else:
                ms = item['timestamp'] if sdk or self.exchange == 'binance' else item['ts'] if 'ts' in item else item['timestamp']
                ratio = numeric(item['longShortRatio'])
            if ratio < 0:
                raise ValueError('Negative ratio')
            return {'timestamp': millis(ms),
                    'long_short_account_ratio': ratio}
        if sdk:
            if item.get('symbol') != self.symbol:
                raise ValueError('Wrong trade market')
            ms, price, amount, side, identity = item['timestamp'], numeric(item['price']), numeric(item['amount']), item['side'], item['id']
        elif self.exchange == 'okx':
            if item.get('instId') != self.contract:
                raise ValueError('Wrong trade market')
            ms, price, amount, side, identity = item['ts'], numeric(item['px']), numeric(item['sz']), item['side'], item['tradeId']
        else:
            if not isinstance(item.get('isBuyerMaker'), bool):
                raise ValueError('Missing aggressor direction')
            ms, price, amount, identity = item['time'], numeric(item['price']), numeric(item['qty']), item['id']
            side = 'sell' if item['isBuyerMaker'] else 'buy'
        if min(price, amount) <= 0 or side not in ('buy', 'sell') or identity is None:
            raise ValueError('Invalid trade')
        return {'timestamp': millis(ms), 'id': str(identity), 'side': side, 'price': price,
                'amount_base': amount * market['contract_size_base'],
                'amount_contracts': amount if self.exchange == 'okx' else None}
