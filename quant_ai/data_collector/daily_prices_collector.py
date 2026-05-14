from __future__ import annotations

import argparse
import os
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import akshare as ak
import pandas as pd
from sqlalchemy import text


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from data_collector.db import get_engine

TZ_SH = ZoneInfo("Asia/Shanghai")

# AkShare stock_zh_a_hist 常见中文列名（不同版本可能略有差异，另有索引回退）
_HIST_RENAME_ZH = {
    "日期": "trade_date",
    "开盘": "open",
    "收盘": "close",
    "最高": "high",
    "最低": "low",
    "成交量": "volume",
    "成交额": "amount",
}


def normalize_hist_df(df: pd.DataFrame) -> pd.DataFrame:
    if df is None or df.empty:
        return pd.DataFrame(
            columns=["trade_date", "open", "high", "low", "close", "volume", "amount"]
        )

    renamed = df.rename(columns=_HIST_RENAME_ZH)
    need = ["trade_date", "open", "high", "low", "close", "volume", "amount"]
    if all(c in renamed.columns for c in need):
        out = renamed[need].copy()
    elif len(df.columns) >= 8:
        out = pd.DataFrame(
            {
                "trade_date": df.iloc[:, 0],
                "open": df.iloc[:, 2],
                "close": df.iloc[:, 3],
                "high": df.iloc[:, 4],
                "low": df.iloc[:, 5],
                "volume": df.iloc[:, 6],
                "amount": df.iloc[:, 7],
            }
        )
    else:
        raise ValueError(f"无法识别日 K 列结构: {list(df.columns)}")

    out["trade_date"] = pd.to_datetime(out["trade_date"], errors="coerce").dt.date
    for col in ("open", "high", "low", "close", "volume", "amount"):
        out[col] = pd.to_numeric(out[col], errors="coerce")
    out = out.dropna(subset=["trade_date"])
    return out


def to_ak_yyyymmdd(d: date) -> str:
    return d.strftime("%Y%m%d")


def parse_backfill_start() -> date:
    raw = os.getenv("DAILY_BACKFILL_START", "20100101").strip()
    return datetime.strptime(raw, "%Y%m%d").date()


def sleep_between_stocks() -> None:
    sec = float(os.getenv("DAILY_COLLECTOR_SLEEP_SEC", "0") or "0")
    if sec > 0:
        time.sleep(sec)


def fetch_hist(symbol: str, start: date, end: date, adjust: str) -> pd.DataFrame:
    return ak.stock_zh_a_hist(
        symbol=symbol,
        period="daily",
        start_date=to_ak_yyyymmdd(start),
        end_date=to_ak_yyyymmdd(end),
        adjust=adjust,
    )


def load_active_stocks(engine, symbol_filter: str | None) -> list[tuple[int, str]]:
    if symbol_filter:
        sym = symbol_filter.zfill(6)
        sql = text(
            "SELECT id, symbol FROM stocks WHERE is_active = TRUE AND symbol = :symbol"
        )
        with engine.connect() as conn:
            rows = conn.execute(sql, {"symbol": sym}).all()
        if not rows:
            raise SystemExit(f"数据库中未找到股票: {sym}，请先运行 stock_list_collector")
        return [(int(r[0]), str(r[1])) for r in rows]

    sql = text("SELECT id, symbol FROM stocks WHERE is_active = TRUE ORDER BY symbol")
    with engine.connect() as conn:
        rows = conn.execute(sql).all()
    if not rows:
        raise SystemExit("stocks 表为空，请先运行 stock_list_collector")
    return [(int(r[0]), str(r[1])) for r in rows]


def load_max_trade_dates(engine) -> dict[int, date]:
    sql = text(
        """
        SELECT stock_id, MAX(trade_date) AS max_d
        FROM daily_prices
        GROUP BY stock_id
        """
    )
    with engine.connect() as conn:
        rows = conn.execute(sql).all()
    return {int(r[0]): r[1] for r in rows if r[1] is not None}


def rows_for_upsert(stock_id: int, df: pd.DataFrame) -> list[dict[str, int | float | date]]:
    rows: list[dict[str, int | float | date]] = []
    for r in df.to_dict(orient="records"):
        vol = r.get("volume")
        amt = r.get("amount")
        rows.append(
            {
                "stock_id": stock_id,
                "trade_date": r["trade_date"],
                "open": float(r["open"]),
                "high": float(r["high"]),
                "low": float(r["low"]),
                "close": float(r["close"]),
                "volume": int(vol) if pd.notna(vol) else 0,
                "amount": float(amt) if pd.notna(amt) else 0.0,
            }
        )
    return rows


def upsert_daily_prices(engine, rows: list[dict[str, int | float | date]]) -> int:
    if not rows:
        return 0
    sql = text(
        """
        INSERT INTO daily_prices (
            stock_id, trade_date, open, high, low, close, volume, amount
        )
        VALUES (
            :stock_id, :trade_date, :open, :high, :low, :close, :volume, :amount
        )
        ON CONFLICT (stock_id, trade_date)
        DO UPDATE SET
            open = EXCLUDED.open,
            high = EXCLUDED.high,
            low = EXCLUDED.low,
            close = EXCLUDED.close,
            volume = EXCLUDED.volume,
            amount = EXCLUDED.amount
        """
    )
    with engine.begin() as conn:
        conn.execute(sql, rows)
    return len(rows)


def collect_for_stock(
    engine,
    stock_id: int,
    symbol: str,
    end: date,
    max_by_stock: dict[int, date],
    full_resync: bool,
    adjust: str,
) -> int:
    if full_resync:
        start = parse_backfill_start()
    else:
        last = max_by_stock.get(stock_id)
        start = parse_backfill_start() if last is None else last + timedelta(days=1)

    if start > end:
        return 0

    df = fetch_hist(symbol, start, end, adjust=adjust)
    norm = normalize_hist_df(df)
    rows = rows_for_upsert(stock_id, norm)
    return upsert_daily_prices(engine, rows)


def main() -> None:
    parser = argparse.ArgumentParser(description="采集 A 股日 K 并写入 daily_prices（支持增量）")
    parser.add_argument("--symbol", help="仅采集指定 6 位代码，例如 000001")
    parser.add_argument("--limit", type=int, default=0, help="最多处理 N 只股票（0 表示不限制）")
    parser.add_argument(
        "--full-resync",
        action="store_true",
        help="忽略已有数据的最大日期，从 DAILY_BACKFILL_START 重新拉取到今日",
    )
    parser.add_argument(
        "--adjust",
        default="",
        choices=["", "qfq", "hfq"],
        help="复权方式：空字符串不复权，qfq 前复权，hfq 后复权",
    )
    args = parser.parse_args()

    end = datetime.now(TZ_SH).date()
    engine = get_engine()
    stocks = load_active_stocks(engine, args.symbol)
    if args.limit and args.limit > 0:
        stocks = stocks[: args.limit]

    max_by_stock = {} if args.full_resync else load_max_trade_dates(engine)

    total_rows = 0
    ok = 0
    for i, (stock_id, symbol) in enumerate(stocks, start=1):
        try:
            n = collect_for_stock(
                engine,
                stock_id,
                symbol,
                end,
                max_by_stock,
                full_resync=args.full_resync,
                adjust=args.adjust,
            )
            total_rows += n
            ok += 1
            if n and (i % 200 == 0 or i == len(stocks)):
                print(f"进度 {i}/{len(stocks)}，累计写入行数（本次 upsert）：{total_rows}")
        except Exception as exc:  # noqa: BLE001
            print(f"[跳过] {symbol}: {exc}")
        sleep_between_stocks()

    print(f"完成：成功处理 {ok}/{len(stocks)} 只股票，本次 upsert 总行数约 {total_rows}")


if __name__ == "__main__":
    main()
