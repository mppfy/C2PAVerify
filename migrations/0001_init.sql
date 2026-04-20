-- C2PAVerify — initial schema.
-- Observability log for kill-review metrics (paid_calls, unique_agents, revenue, errors).

CREATE TABLE IF NOT EXISTS service_calls (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id      TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('success', 'error', 'unpaid')),
  latency_ms      INTEGER NOT NULL,
  revenue_usd     REAL NOT NULL DEFAULT 0,
  upstream_cost_usd REAL NOT NULL DEFAULT 0,
  agent_id        TEXT,
  payer_wallet    TEXT,
  protocol        TEXT,
  timestamp       INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_service_calls_ts ON service_calls(timestamp);
CREATE INDEX IF NOT EXISTS idx_service_calls_status ON service_calls(status);
CREATE INDEX IF NOT EXISTS idx_service_calls_wallet ON service_calls(payer_wallet);
