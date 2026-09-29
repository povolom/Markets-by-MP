"""Local, manual CAD holdings tracker. Python standard library only."""
import argparse
import json
import os
import re
import sqlite3
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

STATIC = Path(__file__).parent / "static"
DEFAULT_DB = Path.home() / "Library/Application Support/Investing-Portfolio/portfolio.sqlite3"


def decimal_field(value, name, *, positive=False):
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        raise ValueError(f"{name} must be a number.")
    try:
        result = Decimal(str(value))
    except InvalidOperation:
        raise ValueError(f"{name} must be a number.") from None
    if not result.is_finite() or result < 0 or result > Decimal("1000000000"):
        raise ValueError(f"{name} must be between 0 and 1 billion.")
    if positive and result == 0:
        raise ValueError(f"{name} must be greater than zero.")
    if result.as_tuple().exponent < -6:
        raise ValueError(f"{name} supports at most six decimal places.")
    return result


def validate_holding(data):
    if not isinstance(data, dict):
        raise ValueError("Expected a holding object.")
    symbol = data.get("symbol", "")
    if not isinstance(symbol, str) or not re.fullmatch(r"[A-Za-z0-9.^:-]{1,20}", symbol):
        raise ValueError("Symbol needs 1–20 letters, numbers, dots, hyphens, carets or colons.")
    return {"symbol": symbol.upper(), **{
        key: str(decimal_field(data.get(key), key, positive=key == "shares"))
        for key in ("shares", "average_cost", "price")
    }}


def money(value):
    return str(value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def summarize(holdings):
    rows = []
    total_cost = Decimal(0)
    total_value = Decimal(0)
    for holding in holdings:
        shares = Decimal(holding["shares"])
        cost = shares * Decimal(holding["average_cost"])
        value = shares * Decimal(holding["price"])
        total_cost += cost
        total_value += value
        rows.append({**dict(holding), "cost": money(cost), "value": money(value),
                     "unrealized": money(value - cost)})
    for row in rows:
        raw_value = Decimal(row["shares"]) * Decimal(row["price"])
        row["allocation"] = money(raw_value / total_value * 100) if total_value else "0.00"
    return {"currency": "CAD", "holdings": rows, "cost": money(total_cost),
            "value": money(total_value), "unrealized": money(total_value - total_cost)}


def connect(path):
    db = sqlite3.connect(path)
    db.row_factory = sqlite3.Row
    db.execute("CREATE TABLE IF NOT EXISTS holdings (symbol TEXT PRIMARY KEY, shares TEXT NOT NULL, average_cost TEXT NOT NULL, price TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)")
    return db


def make_handler(database):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format, *args):
            pass

        def respond(self, status, data, content_type="application/json"):
            body = json.dumps(data).encode() if content_type == "application/json" else data
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
            self.end_headers()
            self.wfile.write(body)

        def valid_host(self):
            return self.headers.get("Host") == f"127.0.0.1:{self.server.server_port}"

        def do_GET(self):
            if not self.valid_host():
                return self.respond(403, {"error": "Open the printed 127.0.0.1 address."})
            if self.path == "/api/portfolio":
                with connect(database) as db:
                    return self.respond(200, summarize(db.execute("SELECT * FROM holdings ORDER BY symbol").fetchall()))
            files = {"/": ("index.html", "text/html; charset=utf-8"),
                     "/app.js": ("app.js", "text/javascript; charset=utf-8"),
                     "/style.css": ("style.css", "text/css; charset=utf-8")}
            if self.path not in files:
                return self.respond(404, {"error": "Not found."})
            filename, content_type = files[self.path]
            self.respond(200, (STATIC / filename).read_bytes(), content_type)

        def do_POST(self):
            origin = f"http://127.0.0.1:{self.server.server_port}"
            if not self.valid_host() or self.headers.get("Origin") != origin:
                return self.respond(403, {"error": "Requests must come from this app."})
            if self.path not in ("/api/holding", "/api/remove"):
                return self.respond(404, {"error": "Not found."})
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= 4096 or self.headers.get("Content-Type") != "application/json":
                    raise ValueError("Send a small JSON object.")
                data = json.loads(self.rfile.read(size))
                if not isinstance(data, dict):
                    raise ValueError("Expected an object.")
                with connect(database) as db:
                    if self.path == "/api/remove":
                        symbol = data.get("symbol")
                        if not isinstance(symbol, str) or len(symbol) > 20:
                            raise ValueError("Invalid symbol.")
                        db.execute("DELETE FROM holdings WHERE symbol = ?", (symbol,))
                    else:
                        holding = validate_holding(data)
                        db.execute("INSERT INTO holdings (symbol, shares, average_cost, price) VALUES (:symbol, :shares, :average_cost, :price) ON CONFLICT(symbol) DO UPDATE SET shares=excluded.shares, average_cost=excluded.average_cost, price=excluded.price, updated_at=CURRENT_TIMESTAMP", holding)
                self.respond(200, {"ok": True})
            except (ValueError, UnicodeDecodeError) as error:
                self.respond(400, {"error": str(error)})
    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    args = parser.parse_args()
    os.umask(0o077)
    args.db.parent.mkdir(parents=True, exist_ok=True)
    with connect(args.db):
        pass
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(args.db))
    print(f"Open http://127.0.0.1:{server.server_port} — database: {args.db}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
