# 衍生观察：云端定时采集已接入

公开副本目标仓库为 `restartnora18-eng/derivatives-dashboard`。项目文件不继承原私人仓库的 Git 提交历史；新提交使用 GitHub 隐私邮箱。当前费率按小时计划更新，历史约每 8 小时刷新。
运行与发布说明见 [DEPLOY.md](DEPLOY.md)，后续折线综合驾驶舱目标见 [ROADMAP.md](ROADMAP.md)。

直接打开 `index.html` 即可查看已保存的数据。已打开页面时重新加载即可看到更新。
不需要安装依赖，不连接账户，不自动轮询网络，无常驻采集服务。

## 当前能力

- 七个页面入口（总览及六个分析模块）；资金费率搜索、排序、分页和详情。
- 数据集切换：BTC/ETH 按需采集快照，以及原项目多标的历史演示快照。
- 显示原始周期费率、结算周期、线性年化、完整合约、来源时间、采集时间和交易所状态。
- 已结算历史：BTC/ETH、交易所筛选、最近 7 天/30 天切换、结算散点图、最近 20 条明细、来源与失败状态。
- 其余指标待后续步骤。当前只覆盖四家交易所的 BTC/ETH USDT 线性永续。

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
