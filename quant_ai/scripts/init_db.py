from pathlib import Path
import sys

from sqlalchemy import create_engine, text


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from data_collector.config import DATABASE_URL  # noqa: E402


def main() -> None:
    schema_path = PROJECT_ROOT / "database" / "schema.sql"
    schema_sql = schema_path.read_text(encoding="utf-8")

    engine = create_engine(DATABASE_URL, pool_pre_ping=True, future=True)
    with engine.begin() as conn:
        conn.execute(text(schema_sql))

    print("数据库表结构初始化完成")


if __name__ == "__main__":
    main()
