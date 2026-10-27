# Binance BTC five-minute monitor

The BTC minute chart defaults to **Binance BTCUSDT USDT perpetual**. The original OKX history remains a separate selectable dataset; historical numbers are never combined across venues.

- OI: `https://fapi.binance.com/futures/data/openInterestHist`, `period=5m`.
- Price: `https://fapi.binance.com/fapi/v1/markPriceKlines`, `interval=5m`; completed mark-price candle closes only, not a live trade ticker.
- Display, tooltip and CSV local-time column: `Asia/Shanghai` (UTC+8). Raw UTC source timestamps are preserved.
- Open page: request at five-minute boundaries plus 15 seconds; manual refresh and refresh on returning to a stale tab are supported. Browser throttling and computer sleep can delay requests.
- Cloud: `.github/workflows/binance-five-minute.yml` uses a five-minute cron and the existing Pages deployment. GitHub scheduled runs may be delayed; it is not a guaranteed real-time service. The existing hourly multi-venue collectors are unchanged.
- The browser can merge the same-origin cloud snapshot and direct official Binance responses. Saved public records are retained for 30 days, with five days initially requested. Failures never update record timestamps or substitute OKX data. Over-15-minute-old records are marked stale.
- OI pagination goes backwards because Binance returns the newest records in a requested window; candle pagination goes forwards. Missing timestamps are left missing and visual lines break across large gaps.
- No credentials, exchange account connection, order placement, VPN, DNS or system configuration changes are required.

Offline verification: `python -B -m unittest discover -s tests -v` and `node --test tests/*.cjs`. Tests cover both endpoints, original timestamps, invalid/future values, incomplete candles, endpoint-specific pagination, failure retention, source separation and the browser refresh scheduler.
