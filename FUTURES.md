# 交割基差与期限结构（阶段 07）

新增 `collect_futures.py`、`futures-data.js`、`futures-ui.js`，作为基差页的独立面板，保留永续溢价。

OKX `public/instruments` 校验 instFamily、settleCcy、ctType、state、expTime；每币种最多最近四个未到期 USDT 线性交割合约。`public/mark-price` 与 `market/index-tickers` 获取价格，每币种三个公开 GET，共最多六个，无 API 密钥。价格需在三分钟内，时间差不超过 120 秒。

基差 = (mark / index - 1) × 100%；简单年化 = 基差 × 365 / 实际剩余天数。距到期不足一天时不计算年化。简单年化不是实际收益，未扣费用与滑点，标记价和指数也不是可成交报价。

期限图以到期日为横轴，历史图跟踪同一个完整合约，不拼接换月。保留近三十天历史，超过两小时的观测缺口断线。失败保留旧快照并标注时间与状态；已到期合约从期限曲线剔除。

`cloud_update.py` 调用新增模块；`build_site.py` 及工作流负责静态打包、保存与发布。不增加本地常驻任务。

官方资料：[OKX 合约信息](https://www.okx.com/docs-v5/en/#public-data-rest-api-get-instruments)。
