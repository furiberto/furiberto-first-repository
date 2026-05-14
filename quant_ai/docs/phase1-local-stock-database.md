# 第一阶段：本地股票数据库

第一阶段只做一件事：把本地股票数据库打牢。

## 目标

- 保存 A 股股票基础信息
- 保存日线行情数据
- 保存财务报告数据
- 预留新闻数据表
- 支持后续每日增量更新

## 已建立的核心表

- `stocks`：股票基础信息
- `daily_prices`：日 K 行情
- `financial_reports`：财务数据
- `news`：新闻数据

## 当前第一个采集器

`data_collector/stock_list_collector.py` 会通过 AkShare 获取 A 股股票列表，并写入 `stocks` 表。

## 日 K 采集器

`data_collector/daily_prices_collector.py` 使用 AkShare `stock_zh_a_hist` 拉取日 K，并写入 `daily_prices` 表。

行为说明：

- 默认按 `Asia/Shanghai` 的「今天」作为结束日期。
- 若某股票在库中已有日 K，则从 `MAX(trade_date) + 1` 开始增量拉取。
- 若某股票尚无日 K，则从环境变量 `DAILY_BACKFILL_START`（默认 `20100101`）开始回填。
- `--full-resync` 会忽略已有最大日期，从 `DAILY_BACKFILL_START` 重拉到今日（用于修复数据或切换复权口径）。

后续建议按这个顺序继续：

1. 增加财务数据采集器
2. 增加采集日志、失败重试与任务调度（Windows 任务计划程序或 Linux cron）
3. 再接入 C++ 量化核心
