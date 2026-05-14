# quant_ai

本项目用于逐步搭建本地 A 股量化分析系统。第一阶段目标是建立稳定的本地股票数据库。

## 当前阶段

已包含：

- PostgreSQL 数据库表结构
- AkShare A 股股票列表采集器
- 数据库初始化脚本
- 基础 Python 依赖清单

## 快速开始

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
