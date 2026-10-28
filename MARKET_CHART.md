# 主站行情图表

入口：`#charts`。本地托管 TradingView Lightweight Charts 5.2.1（原始 npm 发布包 standalone ESM），无需第三方 CDN。

- Binance USDⓈ-M BTCUSDT / ETHUSDT，5m、15m、1h、4h、1d，最近 500 根成交价 K 线。
- 官方只读接口 `https://fapi.binance.com/fapi/v1/klines`，每15秒轮询，后台页面暂停轮询，恢复时刷新。
- Unix 秒时间戳不做偏移；轴、十字线和状态显示北京时间。
- 成交量为基础币；MA20 按连续 K 线的 close 计算，最后一根可能尚未收盘。
- 请求超时/失败保留同合约旧图并明确提示；换合约/周期先清空，取消过时请求。空响应或无效 OHLCV 不发布到图表，不生成替代行情。
- 离开页面时清理图表、监听器、定时器和在途请求。返回页面重新初始化。
- 缺失 K 线插入 whitespace；均线在缺口后重新积累20根。
- 保留内置 TradingView 链接、原始 NOTICE 和 Apache 2.0 LICENSE。

验证：`node --test tests/*.cjs`、`python3 -B -m unittest discover -s tests -q`、`python3 -B build_site.py --hosted`。

官方文档：https://tradingview.github.io/lightweight-charts/docs
行情字段：https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Kline-Candlestick-Data
