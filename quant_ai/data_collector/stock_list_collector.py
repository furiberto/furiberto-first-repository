from pathlib import Path
import sys

import akshare as ak
from sqlalchemy import text


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from data_collector.db import get_engine


def infer_exchange(symbol: str) -> str:
    if symbol.startswith("6"):
        return "SH"
    if symbol.startswith(("0", "3")):
        return "SZ"
    if symbol.startswith(("4", "8", "9")):
        return "BJ"
    return "UNKNOWN"


def fetch_a_share_stock_list() -> list[dict[str, str]]:
    df = ak.stock_info_a_code_name()
    df = df.rename(columns={"code": "symbol", "name": "name"})
    df = df[["symbol", "name"]].dropna()

    stocks: list[dict[str, str]] = []
    for row in df.itertuples(index=False):
        symbol = str(row.symbol).zfill(6)
        stocks.append(
            {
                "symbol": symbol,
                "name": str(row.name),
                "exchange": infer_exchange(symbol),
            }
        )
    return stocks


def upsert_stocks(stocks: list[dict[str, str]]) -> int:
    if not stocks:
        return 0

    sql = text(
        """
        INSERT INTO stocks (symbol, name, exchange, market, is_active)
        VALUES (:symbol, :name, :exchange, 'A股', TRUE)
        ON CONFLICT (symbol)
        DO UPDATE SET
            name = EXCLUDED.name,
            exchange = EXCLUDED.exchange,
            market = EXCLUDED.market,
            is_active = TRUE
        """
    )

    engine = get_engine()
    with engine.begin() as conn:
        conn.execute(sql, stocks)
    return len(stocks)


def main() -> None:
    stocks = fetch_a_share_stock_list()
    count = upsert_stocks(stocks)
    print(f"已同步 A 股股票列表：{count} 只")


if __name__ == "__main__":
    main()
