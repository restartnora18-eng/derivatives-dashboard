# Kimra 独立只读数据适配层

位置：项目根目录 `market_adapters/`。它位于交易所 API 与校验/存储之间，不放在网页图表或模拟撮合引擎里。

**默认原生 API，可选择 CCXT，也可并行对照。当前六大页面及模拟盘继续使用原有采集器，本版不做全局替换，不增加网页上的全局数据源按钮。**

```text
现有页面 ── 原有采集器 ── 原生 API（保持原样）

独立验证/未来模块 ── ReadOnlyAdapter
                       ├─ native：复用已有 HTTP 客户端
                       └─ ccxt：CCXT 4.5.90
                  ── 统一记录、单位校验、来源标识 ── 未来按模块接入存储和展示
```

## 选择方式

`market-source.json` 是新适配层的默认设置，初始值为 `"provider": "native"`。只接受 provider/exchange/symbol/timeframe/limit，不接受 API key、secret 或任意额外请求参数。

- `native`：原生公开接口，不需要安装 CCXT。
- `ccxt`：使用固定并验证过的 CCXT 版本；需要 Python >=3.10 和可选依赖。
- `compare`：仅作为运行参数，对同一目标分别读取两种方式；不会合并结果或自动改写默认值。

在项目根目录运行：

```bash
# 读取默认配置；首次仍为 native
python -m market_adapters.probe --operation long_short_ratio

# 仅本次使用 CCXT；不会改配置文件
python -m market_adapters.probe --provider ccxt --operation trades

# 对照原生和 CCXT，按相同时间戳/成交ID比较
python -m market_adapters.probe --provider compare --operation oi_history
```

可选依赖应安装在独立虚拟环境中：

```bash
python3.12 -m venv .venv-readonly
.venv-readonly/bin/python -m pip install -r market_adapters/requirements.txt
.venv-readonly/bin/python -m market_adapters.probe --provider ccxt
```

不安装 CCXT 也不影响现有程序。要长期把新适配层默认改为 CCXT，需主动编辑 `market-source.json` 中的 provider。**该配置当前不被旧采集器读取，因此不代表现有页面已迁移。** 后续按模块接入时，再决定哪些模块沿用原生、哪些使用 CCXT。

## 本版接口

仅支持 Binance/OKX 的 BTC、ETH USDT 线性永续、5分钟数据：

- `oi_history`：历史 OI；统一为基础币数量，OKX另保留合约张数。名义值保留原币种标签：OKX为USD、Binance本接口为USDT，不将两者无条件当作同一币种求和。
- `mark_candles`：已完成标记价K线；保留开盘毫秒时间，统一记录时间为收盘边界。
- `long_short_ratio`：多空**账户**比历史，不能当作持仓量比。
- `trades`：公共成交，统一基础币数量，保留OKX合约数量与主动买卖方向。

每份输出均包含 provider、exchange、symbol、contract、requested_at、fetched_at、units、quality、source_endpoints、fallback_used。原始时间戳保持UTC，只在显示层转北京时间。

没有公共强平、Greeks、私有账户、下单或撤单接口。Greeks 后续单独处理原生字段与BS字段的差异；不直接替换现有 deltaBS。

## 只读边界与失效行为

- 原生和 SDK 传输都只允许固定交易所域名、固定公开路径、HTTPS GET。
- 拦截写入方法、未列出的路径、带凭证的URL/查询参数/请求头；不提供任意 SDK 方法调用入口。
- 不接受密钥，不关闭 TLS 校验，不修改 VPN、DNS 或系统设置。
- 请求失败时显式返回失败，不偷偷从 CCXT 切回原生，也不产生假数据。
- OI 必须结合合约面值换算并核对来源币数量；未来时间、无效数值、不符的合约被排除。
- 未收盘K线不进入输出；没有数据与校验失败分别标记。
- 实例复用市场元数据、SDK连接与限速器；不要在高频循环中不断重建适配器。
- Python模块边界不是抵御任意恶意Python代码的隔离沙箱；部署时仍应不给采集进程交易凭证。

输出只打印到终端。使用 `--out work/probe.json` 才保存本次实验结果；不写入生产数据文件，不自动发布网页。

## 验证

```bash
python -B -m unittest discover -s tests -p 'test_market_adapters.py' -v
```

离线测试不需要安装 CCXT，也不会发送网络请求。联网对照需使用当前网络可访问的交易所；CCXT不能解除HTTP 451等访问限制。只有同时间戳/同成交ID的数据才做数值比较，两个请求不是同时发出，不匹配的记录会分开报告。
