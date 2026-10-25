# 订单簿与流动性（阶段10）

OKX BTC/ETH USDT线性永续，每次四个公开GET：public/instruments核对合约单位，market/books请求最多400档/侧。不是实时盘口、全盘口或全市场数据。每小时采样，无本地常驻进程。

只接受ctValCcy等于标的、ctType=linear、settleCcy=USDT、ctMult=1且state=live的合约。价格与挂单数量需为正，买盘严格递减、卖盘严格递增，禁止交叉/锁定盘口。来源时间年龄≤180秒。

逐档币数量=张数×ctVal，名义额=币数量×该档价格（USDT）。中间价=(最优买+最优卖)/2，价差bps=(卖−买)/中间价×10000。

±10/25/50bps统计相应价格范围内观察到的深度。只有返回档位在两侧均到达区间边界，才计算该区间失衡=(买−卖)/(买+卖)×100%。覆盖不全只显示观察下限，失衡为空；不把400档误认为完整指定区间。另提供两侧各前20档的失衡，至少各有20档才计算，两侧价格跨度可能不同。

深度图横轴为相对中间价的基点、纵轴为累计挂单名义额。历史仅保存摘要，30天滚动；完整400档仅保留每币种最新快照。失败保留旧观测并显示状态和时间。可撤挂单不是成交资金，未实现逐笔订单流、撤单率、热力图或实际滑点模拟。

总览增加价差与前20档失衡两图，单位分别为bps、%。原有七页保留。

实现：collect_orderbook.py、orderbook-data.js、orderbook-ui.js；cloud_update.py调用，build_site.py和工作流保存发布。官方说明：[OKX Order book](https://www.okx.com/docs-v5/en/#order-book-trading-market-data-get-order-book)。
