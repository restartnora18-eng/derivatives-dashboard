# 期权波动率（阶段 09）

使用 OKX `public/instruments?instType=OPTION&instFamily=BTC-USD/ETH-USD` 与 `public/opt-summary`，每次更新共四个公开 GET，无密钥。只保存入选合约的必要原始字段，不归档整个期权链。

- 目标期限约7、14、30、60、90天，各取最接近的实际可用到期日并去重，不做恒定期限插值。
- ATM IV近似：选取同期限、同执行价的看涨/看跌，执行价最接近其远期价（绝对对数偏离≤0.05），标记IV取均值。`markVol` 为小数，乘100展示为百分比。
- 25Δ RR近似：`deltaBS` 最近+0.25与−0.25且误差各≤0.03的看涨/看跌，其标记IV之差（call minus put），单位百分点。不插值；缺腿则缺失。
- 只接受同币种USD期权、同币种结算、有效双边IV与deltaBS，IV数值区间(0,10]、bidVol≤askVol、源时间年龄≤180秒、所用合约时间差≤120秒，到期至少一天。宽价差与交易深度尚未进一步筛选，不能视为可成交或充分流动性。
- 每个点保存到期日、选用执行价、远期价、全部选用合约、deltaBS、双边和标记IV、来源时间。失败保留旧快照并标注采集状态；保存近30天。
- 期限结构横轴为到期日；历史图固定到期日，不拼接换月。总览额外显示最接近30天的实际到期日（标题明确注明）的IV和RR，缺失不补零。

这是单所近似统计，不是恒定30天波动率指数，也不是IV Rank、精确Delta插值曲面、Greeks风险敞口或GEX。后者尚未实现。理论标记IV不是可成交IV。

文件：`collect_options.py`采集与计算，`options-data.js`快照，`options-ui.js`页面，`summary-ui.js`总览。`cloud_update.py`和现有GitHub Actions按小时运行，无Mac常驻任务。

官方字段参考：[OKX 期权定价](https://www.okx.com/docs-v5/en/#public-data-rest-api-get-option-market-data)。


## 阶段13：期权持仓结构

collect_option_positions.py每小时增加4个公开GET：BTC/ETH各自的public/instruments与public/open-interest（instType=OPTION、instFamily=BTC-USD或ETH-USD）。按在市未到期合约清单完整匹配，任一缺失不补零、失败保留旧快照。排除不在当前清单内的已到期等返回记录。

使用oiCcy标的币数量，逐合约校验oi×ctVal×ctMult，不将期权乘数假定为1；同时核对币种、结算币、合约类型及正面值。来源时间3分钟内、全合约时间跨度最多120秒。Put/Call OI比=看跌币数量/看涨币数量，分母为0返回null。每个OI合约都有双方，比例不是成交量比、持有人方向、预测信号或做市商Gamma。

最近快照含到期日汇总、匹配计数、单位值和输入指纹；指纹不是原始全链备份。近30天仅保存全当时在市合约的合计历史；到期/上市会改变统计集合，因此不是固定组合历史。独立于IV模块，不混用IV过滤合约清单。

官方来源：https://www.okx.com/docs-v5/en/#public-data-rest-api-get-open-interest ，以及 https://github.com/okx/agent-skills/blob/github-main/skills/okx-cex-market/references/derivatives-commands.md 。
