# 衍生观察：加密货币衍生品监测

公开副本目标仓库为 `restartnora18-eng/derivatives-dashboard`。项目文件不继承原私人仓库的 Git 提交历史；新提交使用 GitHub 隐私邮箱。当前费率按小时计划更新，历史约每 8 小时刷新。
线上地址：https://restartnora18-eng.github.io/derivatives-dashboard/ 。运行与发布说明见 [DEPLOY.md](DEPLOY.md)，阶段进度见 [ROADMAP.md](ROADMAP.md)。

直接打开 `index.html` 即可查看已保存的数据。已打开页面时重新加载即可看到更新。
不需要安装依赖，不连接账户，不自动轮询网络，无常驻采集服务。

## 当前能力

- 七个页面（总览及六个分析模块）；资金费率搜索、排序、分页和详情。
- 数据集切换：BTC/ETH 按需采集快照，以及原项目多标的历史演示快照。
- 显示原始周期费率、结算周期、线性年化、完整合约、来源时间、采集时间和交易所状态。
- 已结算历史：BTC/ETH、交易所筛选、最近 7 天/30 天切换、结算散点图、最近 20 条明细、来源与失败状态。
- OKX BTC/ETH USDT永续：标记价格、币数量/张数/USD未平仓量、永续溢价和盘口深度。其他交易所资金费率依实际接口可用性显示；不代表所有模块都覆盖四家交易所。
- OKX USD计价、币本位交割期货基差与实际到期日结构；不与USDT永续混用。
- OKX期权ATM IV及25Δ RR近似值、固定实际到期日历史、完整当前在市合约Put/Call持仓比及到期日持仓分布。
- 实验性强平观察样本与破产价散点：来源为已从正式文档移除但目前仍响应的有界REST接口，不代表完整事件或全市场总额。
- 盘口假设成交/滑点模拟：使用已保存400档快照，不下单、不外推未覆盖价格。
- 总览原单位九组指标共享时间轴；新增七类指标历史分位监测、固定0–100纵轴和20/80区间。每个观测需要至少20个不同的此前UTC参考日；目前历史不足显示积累中，不产生虚假分数。

### 数据频率与边界

GitHub Actions计划在每小时UTC第17分钟采样（可能延迟），结算历史约每8小时刷新；不是实时流。浏览器重新加载读取静态快照，不自动持续请求交易所。新模块从首次真实采集开始积累，近30天保留策略不会创造上线前的历史。

当前多数新增分析模块仅覆盖OKX；Binance/Bybit可能受403/451限制，失败状态直接展示，不绕过限制。数据缺失不补零，不把单所数据称作全市场数据。ATM/RR为指定口径近似值，期权OI/PCR不是成交量或交易方向；市场分位不是风险概率或预测信号。

详细口径：[交割基差](FUTURES.md)、[期权与持仓结构](OPTIONS.md)、[盘口与滑点](ORDERBOOK.md)、[实验性强平](LIQUIDATIONS.md)、[历史分位](PERCENTILES.md)。

### 验证与资源

Python标准库、原生JavaScript/SVG，无依赖安装、API密钥或本地采集守护进程。开发验证：`python3 -B -m unittest discover -s tests`、`node --test tests/*.cjs`、`python3 -B build_site.py --hosted`。当前66项Python与48项JS测试覆盖关键算法、异常保留与实际数据渲染。发布目录使用显式文件清单，不包含采集源码和原始审计目录；公开GitHub仓库仍会包含仓库内的项目源码和行情数据。

上述为已实现范围，以下保留早期模块的详细操作说明，不表示整个长期系统已经完成。未接入付费聚合源、持续WebSocket、全市场强平、订单流、做市商净GEX或经过检验的综合评分。

## 第三步：已结算历史

在本目录按需运行一次：

```sh
python3 -B collect_history.py
```

下载截至本次采集时刻最近 30 天的公开结算记录。运行结束即退出。
页面的 7 天、30 天窗口都以该次采集截止时间为基准，并在页面显示截止日期；不是持续滚动的实时窗口。
历史模块是独立数据集，即使上方切换到原项目演示快照，下方仍明确显示交易所已结算历史。

图表纵轴是每次结算的费率百分比。不同合约的历史周期可能不同，当前不推定历史周期或历史年化。
每次结算一个点，不在点之间连线或补齐缺失数据。悬停或键盘聚焦可查看精确日期与数值。
相邻时刻间隔超过样本中位间隔的 1.5 倍时提示“疑似缺口或周期变化”，这是提示规则，不是缺失数据的确定判断。

| 文件 | 作用 |
|---|---|
| `collect_history.py` | 历史接口适配、有限分页、校验、去重及保存 |
| `data/settled/latest.json` | 按交易所与合约分别保存最近一次有数据的历史集，保留原始响应 |
| `data/settled/last-attempt.json` | 最近一次历史采集尝试与覆盖状态 |
| `data/settled/attempts/*.json` | 每次历史运行存档 |
| `history-data.js` | 页面使用的精简历史数据，不包含完整原始响应页 |
| `history-chart.js` | 时间窗口、数据点及 SVG 图表生成，无第三方图表依赖 |
| `history-ui.js` | 历史筛选、摘要、明细及与合约详情的联动 |

历史接口：
- Binance `/fapi/v1/fundingRate`：普通结算事件，按 `startTime` 向后分页。
- Bybit `/v5/market/funding/history`：按 `endTime` 向前分页。
- OKX `/api/v5/public/funding-rate-history`：读取实际 `realizedRate`，不以预测 `fundingRate` 替代；使用 `after` 请求更旧记录。
- Bitget `/api/v3/market/history-fund-rate`：`cursor` 为从 1 开始的页码，使用 `resultList`。

每合约最多 8 页、仅查询 30 天；当前正常情况每个可用合约 1 页。分页无推进会停止并警告。
翻页中途失败会保留本次已取得记录并标记覆盖风险；某合约完全失败则保留该合约原来的历史集及原采集时间。
页面展示实际起止日期，不把“发起了 30 天查询”当作“有完整 30 天数据”的证明。

2026-10-25 本环境实测：OKX 180 条、Bitget 180 条（各为 BTC 90 条、ETH 90 条），Binance HTTP 451、Bybit HTTP 403。

## 按需采集（一次运行即结束）

使用 Python 3.9 或更高版本，只依赖标准库。在本目录运行：

```sh
python3 -B collect_funding.py
```

采集器只向四家交易所的公开行情接口发送 GET 请求。不需要 API Key。
正常每轮约 8—12 次请求，失败仅对临时网络错误、429、5xx 最多重试一次；每请求超时 8 秒。
403/451 不重试，也不会更换域名或代理绕过。测试和采集均运行结束后退出。
已提供 `.github/workflows/update.yml`：每小时采集当前费率，历史约每 8 小时采集。
工作流已上传默认分支 `main`，首次自动运行成功；Pages 另用 `ENABLE_PAGES` 控制，当前关闭。

## 数据与失败处理

| 文件 | 作用 |
|---|---|
| `snapshot.js` | 原项目快照，不被采集器覆盖 |
| `collect_funding.py` | 四家适配器、周期核验、计算、校验和保存 |
| `data/latest.json` | 最近一次至少返回一条记录的快照 |
| `data/last-attempt.json` | 最近一次尝试，包括全部失败情况 |
| `data/history/*.json` | 有数据的采集快照，文件名带微秒；不代表已结算费率历史 |
| `data/attempts/*.json` | 每次运行结果及错误 |
| `funding-data.js` | 页面读取的单文件数据包，同时包含快照和最近尝试状态 |
| `data-model.js` | 数据集转换、时效校验、过滤与排序 |
| `tests/` | 合成输入的离线测试，不作为真实市场数据展示 |

数据保留周期费率的小数字符串、数值与百分数、周期依据、来源接口和原始响应。
周期费率 `0.0001` 对应 `0.01%`；8 小时周期的线性年化为 `10.95%`。
未知或无效周期不计算年化。真实的 `0` 保留为零；缺失不会转为零。
直接运行本地采集时，来源时间阈值默认 30 分钟；云端每小时采集对应阈值 90 分钟，写入快照供页面读取。
超过该阈值、未来偏差超过 5 分钟、结算/更新时间已过或关键字段缺失的记录不参与有效排名。
这是本系统的质量规则，不是交易所保证的更新频率。
页面仅在数据过期时做一次本地状态更新，不发送网络请求。

部分采集失败：保存本轮成功记录，失败交易所明确标记，不混入旧记录。
全部采集失败：保留 `latest.json`，刷新失败状态，退出码为 1。
有记录但字段未核验：保留原始数据，标记警告，退出码为 0，不能将退出码单独当作数据质量判定。

## API 与周期口径

| 交易所 | 公开接口 | 周期处理 |
|---|---|---|
| Binance | `/fapi/v1/premiumIndex` + `/fapi/v1/fundingInfo` | 仅用明确返回的 `fundingIntervalHours`。调整列表中没有该合约时，不推定为 8h |
| Bybit | `/v5/market/tickers`；必要时 `/v5/market/instruments-info` | 优先 `fundingIntervalHour`；回退将合约字段 `fundingInterval` 从分钟换算成小时 |
| OKX | `/api/v5/public/funding-rate` | 按文档由 `nextFundingTime - fundingTime` 计算周期；`fundingRate` 是待结算估计值 |
| Bitget | `/api/v3/market/current-fund-rate` | 使用 `fundingRateInterval` 小时；`nextUpdate` 单独标记为更新时间 |

来源文档：
- https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Get-Funding-Rate-Info
- https://bybit-exchange.github.io/docs/v5/market/tickers
- https://bybit-exchange.github.io/docs/v5/market/instrument
- https://my.okx.com/docs-v5/
- https://www.bitget.com/docs/catalog/market/derivatives

2026-10-25 本环境实际验证：OKX 与 Bitget 共返回 BTC/ETH 四条记录；Binance HTTP 451、Bybit HTTP 403。
两家受限接口的适配逻辑通过离线合成测试，但尚未在本环境取得成功实测响应。地域、网络和运行环境改变后结果可能不同。

## 验证

```sh
python3 -B -m unittest discover -s tests -v
node --test tests/test_data_model.cjs
node --test tests/test_history_chart.cjs
node --check app.js
```

浏览器视觉与点击验收尚未完成：当前浏览器工具阻止 file:// 自动访问。

数据来源：https://github.com/ruleaker/perp-funding-screener/blob/main/data/latest.json

指标参考：https://github.com/ruleaker/awesome-derivatives-data

保留原项目 MIT 许可证，见 LICENSE。网页和此次标准库采集器为新增实现，参考原项目快照架构。
仅“原项目历史演示”数据集沿用 8 小时假设；新的采集数据使用已返回的周期字段。


## OI 第一版（阶段 04）

新增 OKX BTC/ETH USDT 永续持仓量：oi（张）、oiCcy（币）、oiUsd（USD）分别展示。官方字段说明：https://app.okx.com/docs-v5/zh/#public-data-rest-api-get-open-interest 。每次云端更新额外发送 2 个公开 GET 请求，无 API 密钥。按小时积累近 30 天真实观测，7/30 天切换，首末变化不冒充 24 小时变化；缺失超过 2 小时断线，首次只有一个点时显示积累中。失败保留旧数据并显示状态与过期标记。单所 OI 不代表全市场，也不能单独判断多空方向。尚未接入其他交易所 OI 或过去历史回补。


## 阶段 05：价格与 OI 对照

新增 OKX BTC/ETH USDT 永续标记价格（markPx，单位 USDT），官方接口说明：https://app.okx.com/docs-v5/zh/#public-data-rest-api-get-mark-price 。每次云端更新额外 2 个公开 GET；保留 30 天观测，价格和 OI 使用共同横轴、独立纵轴上下展示。不是现货或最新成交价。价格失败不影响 OI 保存；各自显示采集状态、数据时间与过期标记，历史缺口不补值。上线前的 OI 记录不补推价格；新价格从首次真实采集开始。


## 阶段 06：永续溢价

基差页面先接入 OKX BTC/ETH USDT 永续溢价：（markPx / idxPx - 1）× 100%，同时展示 USDT 价差。复用本次成功采集的标记价格，每次云端刷新额外 2 个指数 GET，不使用账户或密钥。官方指数接口：https://app.okx.com/docs-v5/zh/#market-data-rest-api-get-index-tickers 。仅配对相同标的 USDT 价格，价格年龄不超过 180 秒，时间差不超过 120 秒，失败保留旧观测并标记状态。保留近 30 天，7/30 天选择，缺口断线与零溢价参考线。永续无到期日，本阶段不做到期年化、期限结构或套利收益推算。新增 collect_basis.py（采集与校验）、basis-data.js（浏览器快照）、basis-ui.js（展示）；cloud_update.py 调用采集，build_site.py 与工作流负责保存和部署。


## Overview charts (stage 08)

The overview now compares five real OKX series on a common time axis: mark price (USDT), OI (coin), settled funding (% per settlement), perpetual premium (USDT index), and one explicitly named USD inverse expiry contract basis (%). Select BTC/ETH and 24h/7d/30d. Each panel retains its own unit and freshness metadata. No composite score, historical backfill or continuous contract splice is generated. Existing seven pages are retained.
