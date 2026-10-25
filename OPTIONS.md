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
