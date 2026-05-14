CREATE TABLE IF NOT EXISTS stocks (
    id BIGSERIAL PRIMARY KEY,
    symbol VARCHAR(16) NOT NULL UNIQUE,
    name VARCHAR(128) NOT NULL,
    exchange VARCHAR(16),
    market VARCHAR(16) NOT NULL DEFAULT 'A股',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS daily_prices (
    id BIGSERIAL PRIMARY KEY,
    stock_id BIGINT NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,
    trade_date DATE NOT NULL,
    open NUMERIC(18, 4),
    high NUMERIC(18, 4),
    low NUMERIC(18, 4),
    close NUMERIC(18, 4),
    volume BIGINT,
    amount NUMERIC(24, 4),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_daily_prices_stock_date UNIQUE (stock_id, trade_date)
);

CREATE TABLE IF NOT EXISTS financial_reports (
    id BIGSERIAL PRIMARY KEY,
    stock_id BIGINT NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,
    report_date DATE NOT NULL,
    report_type VARCHAR(32),
    revenue NUMERIC(24, 4),
    net_profit NUMERIC(24, 4),
    total_assets NUMERIC(24, 4),
    total_liabilities NUMERIC(24, 4),
    raw_data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_financial_reports_stock_date_type UNIQUE (stock_id, report_date, report_type)
);

CREATE TABLE IF NOT EXISTS news (
    id BIGSERIAL PRIMARY KEY,
    stock_id BIGINT REFERENCES stocks(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    source VARCHAR(128),
    url TEXT UNIQUE,
    published_at TIMESTAMPTZ,
    content TEXT,
    raw_data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_daily_prices_trade_date ON daily_prices (trade_date);
CREATE INDEX IF NOT EXISTS idx_financial_reports_report_date ON financial_reports (report_date);
CREATE INDEX IF NOT EXISTS idx_news_published_at ON news (published_at);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stocks_updated_at ON stocks;
CREATE TRIGGER trg_stocks_updated_at
BEFORE UPDATE ON stocks
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_daily_prices_updated_at ON daily_prices;
CREATE TRIGGER trg_daily_prices_updated_at
BEFORE UPDATE ON daily_prices
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_financial_reports_updated_at ON financial_reports;
CREATE TRIGGER trg_financial_reports_updated_at
BEFORE UPDATE ON financial_reports
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_news_updated_at ON news;
CREATE TRIGGER trg_news_updated_at
BEFORE UPDATE ON news
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
