# Five-minute liquidation observations

The liquidation page retains its explicitly labeled **OKX BTC/ETH USDT perpetual** source. Binance OI is a separate module; venues are never silently combined.

- The browser requests recent liquidation samples and confirmed five-minute mark-price candle history every five minutes. Returning after a pause requests fresh data.
- The lightweight GitHub workflow `liquidation-five-minute.yml` also schedules collection and Pages publication every five minutes. GitHub scheduling and deployment can be delayed; actual attempt/source timestamps remain visible.
- Initial price backfill covers the last 24 hours, then retains up to 30 days of acquired five-minute candle closes. Price history is independent of the older hourly price module.
- Source timestamps remain unchanged; dates and axes show Beijing time (Asia/Shanghai, UTC+8).
- The last-24-hour heatmap uses five-minute time bins. Price lines break across gaps over 7.5 minutes. Missing samples are never interpolated or represented as zero liquidations.
- The liquidation REST endpoint remains experimental and returns at most 100 recent details per request. Five-minute polling reduces gaps but does not provide a complete event feed, full-market liquidation amounts or modeled future liquidation levels.
- Numeric event fingerprints deduplicate repeated responses and cloud/browser overlap. Request failures preserve previous records and their timestamps. Browser storage retains up to 10,000 event samples and reports reaching the cap; cloud archive uses the existing collector cap.
- No real trading calls, credentials, VPN, DNS or computer setting changes are involved.
