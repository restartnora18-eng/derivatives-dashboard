# 衍生观察：云端运行与发布

项目仓库：https://github.com/restartnora18-eng/derivatives-dashboard

本副本仅迁移项目文件，不继承之前的私人仓库提交历史。GitHub 操作使用隐私邮箱；自动数据更新使用机器人 noreply 邮箱。

## 运行

- GitHub Actions 每小时 UTC :17 计划更新当前费率，可能因排队而延迟。
- 已结算历史约每 8 小时刷新；手动运行时可勾选 refresh_history。
- 只调用公开行情 GET 接口，无账户、密钥、下单或交易逻辑。
- 私人密码、其他仓库、个人电脑文件不属于本项目的发布文件。
- 当前云端环境下 OKX/Bitget 可用，Binance/Bybit 的 451/403 状态会如实保留。
- 部分交易所失败不填零；全部失败时保留旧快照并更新失败状态。

## 发布开关

1. Settings → Pages → Source 选择 GitHub Actions。
2. Settings → Secrets and variables → Actions → Variables，设置 ENABLE_PAGES=true。
3. 运行 Refresh derivatives data，等待 deploy 成功。

发布仅包含 build_site.py 白名单中的静态页面、公开行情数据和 LICENSE。
Python、测试、原始响应归档不进入网站 dist/；公开 GitHub 仓库中的项目文件仍可浏览。
将 ENABLE_PAGES 改回 false 只停止新发布，不会删除已发布网站。

## 本地检查

```sh
python3 -B -m unittest discover -s tests -v
node --test tests/*.cjs
python3 -B build_site.py --hosted
```

## 资源与维护

电脑无需持续开机；浏览器只读取静态文件，不负责定时采集。当前版本不需要服务器或数据库。
可在 Actions 页面禁用 Refresh derivatives data 以停止未来计划运行。
旧快照与运行存档会增加 Git 历史体积，后续按实际增长归档。
GitHub 长时间无活动可能停用计划工作流，需定期查看 Actions 状态。

未来保留七个页面，并新增共用时间轴的折线综合驾驶舱，详见 ROADMAP.md。
