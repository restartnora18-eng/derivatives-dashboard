# Kimra Paper Trading

Browser-only paper trading for Binance BTCUSDT USDT-margined perpetuals. No exchange account, API key, order API, or real funds are used.

## Use

Open the deployed `/paper-trading/` page. Prices and 1-hour candles are fetched directly from `https://fapi.binance.com` on startup, hourly while the page stays active, and before manual paper trades. All displayed times use UTC+8. Network failures never trigger synthetic or alternate-provider prices.

The chart uses TradingView Lightweight Charts, loaded from a version-pinned public CDN. Attribution is retained in the chart. https://github.com/tradingview/lightweight-charts

## Storage and privacy

Account snapshots and simulated trades stay in IndexedDB in the visitor's browser. There is no application backend, account upload, analytics, or cloud synchronization. Visiting the hosted page does not transfer data from another origin or browser. GitHub and the public market-data/CDN providers receive ordinary website requests under their respective policies.

No personal account backups, live trade records, screenshots, desktop launchers, local paths, or API credentials are included in this source directory. Tests contain clearly marked artificial fixtures and do not supply runtime prices.

## Simulation limits

Paper fills include configured slippage and fees. Margin, fixed funding, and liquidation are local simulations, not exact exchange risk models. Hourly samples do not represent continuous intrahour equity or liquidation monitoring. Collection pauses when the browser closes or sleeps. Long gaps are not filled with invented equity samples.

## Development

Serve this directory with a local HTTP server; ES modules do not run from `file://`. Run `npm test` with Node.js 18 or newer. No dependency installation is required for tests.

## Layout

- `index.html`, `style.css`: chart-first interface and paper trading controls.
- `src/engine.js`: fixed-point accounting and position engine.
- `src/market.js`: official Binance public REST adapter and hourly scheduler.
- `src/storage.js`: browser-local persistence.
- `src/time.js`, `src/assets-chart.js`: UTC+8 formatting and equity chart.
- `tests/`: engine, market parsing, failure and scheduling tests.
