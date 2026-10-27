# BTC 5分钟 OI 研究数据

2026-10-27新增。同一OKX BTC-USDT-SWAP合约，OI历史来自`GET /api/v5/rubik/stat/contracts/open-interest-history`，请求`instId=BTC-USDT-SWAP&period=5m&limit=100`。数组顺序ts/oi/oiCcy/oiUsd对应来源时间、张数、BTC数量、USD名义金额。现场核验period=1m返回51000 Parameter period error，因此本模块明确为5分钟，而非1分钟。

首次向前分页补最多16页，接口可回溯约1440个5分钟观测（约5天）；之后按已有最新时间增量补采，保留重叠窗口校验更新，按来源时间去重，滚动保存30天。每页结束后0.25秒限速，拒绝非5分钟边界/负OI/非有限值/未来时间。分页未推进或失败标为partial/failed，保留已有数据。`states`包含请求页数、接受数、拒绝数和首次分页完成标识，不把空列表解释成OI为0。

价格独立来自`GET /api/v5/market/history-mark-price-candles`，同合约bar=5m、after向前分页。仅接受confirm=1及有效OHLC关系的已结束K线，来源ts为K线开盘时间，绘图放在ts+5分钟的收盘时刻。不将其冒充同一瞬间的成交价或OI观测。

新文件：collect_oi_minutes.py、oi-minutes-data.js、oi-minutes-ui.js、data/oi-minutes/series.json。cloud_update.py在原小时工作流内补采；每小时更新不代表数据点只有小时密度，也不代表实时5分钟刷新。无需新的密钥、依赖或本地常驻任务。正常小时更新通常每条流1页，两次GET；首次回补约30次GET。

BTC OI页默认展示分钟研究，6h/24h/3d/5d切换，BTC/USD/张数切换，同时间轴价格和OI图，7.5分钟缺口断线；缺格统计仅检查区间内首末真实样本之间，不声称端点外覆盖完整。支持CSV导出，UTC保留时间，OI与价格各行分别注明type，不强行连接/填值。原BTC/ETH小时页保留在折叠区。总览BTC OI和更多指标面板同步优先用5分钟数据；ETH沿用小时数据。

官方资料：
- https://www.okx.com/docs-v5/en/#trading-statistics-rest-api-get-contract-open-interest-history
- https://app.okx.com/docs-v5/zh/#order-book-trading-market-data-get-mark-price-candlesticks-history

初次实采：OI1440条、已完成价格K线1499条；OI范围2026-10-22T01:05:00Z至2026-10-27T01:00:00Z。数据结果随采集变化，以文件和网页来源时间为准。
