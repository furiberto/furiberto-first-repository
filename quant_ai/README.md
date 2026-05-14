# quant_ai

本项目用于逐步搭建本地 A 股量化分析系统。第一阶段目标是建立稳定的本地股票数据库。

## 当前阶段

已包含：

- PostgreSQL 数据库表结构
- AkShare A 股股票列表采集器
- AkShare 日 K 采集器（支持增量与全量重拉）
- 数据库初始化脚本
- 基础 Python 依赖清单

## 快速开始

在终端中先进入本仓库的 `quant_ai` 目录，再执行下列命令。

1. 创建虚拟环境：

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

2. 安装依赖：

```powershell
pip install -r requirements.txt
```

3. 准备环境变量：

```powershell
Copy-Item .env.example .env
```

根据你的 PostgreSQL 配置修改 `.env` 中的 `DATABASE_URL`。

4. 创建数据库：

```sql
CREATE DATABASE quant_ai;
```

5. 初始化表结构：

```powershell
python scripts/init_db.py
```

6. 同步 A 股股票列表：

```powershell
python data_collector/stock_list_collector.py
```

7. 同步日 K 到 `daily_prices`：

首次建议先小范围试跑（例如只拉平安银行）：

```powershell
python data_collector/daily_prices_collector.py --symbol 000001 --limit 1
```

全市场全量回填（耗时很长，建议在非高峰时段执行，必要时调大 `.env` 里的 `DAILY_COLLECTOR_SLEEP_SEC`）：

```powershell
python data_collector/daily_prices_collector.py
```

每日增量（同一命令）：脚本会按每只股票在库中的 `MAX(trade_date)` 从下一天拉到「上海时区」的当天日期。

从 `DAILY_BACKFILL_START` 起强制重拉（覆盖已有日 K）：

```powershell
python data_collector/daily_prices_collector.py --full-resync
```
