import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from http.server import ThreadingHTTPServer

from portfolio import connect, make_handler, summarize, validate_holding


class CalculationTests(unittest.TestCase):
    def test_fractional_positions_and_loss(self):
        result = summarize([
            validate_holding(dict(symbol="AAA", shares="2.5", average_cost="10", price="12")),
            validate_holding(dict(symbol="BBB", shares="1", average_cost="20", price="10")),
        ])
        self.assertEqual((result["cost"], result["value"], result["unrealized"]), ("45.00", "40.00", "-5.00"))
        self.assertEqual([r["allocation"] for r in result["holdings"]], ["75.00", "25.00"])

    def test_zero_value_allocation(self):
        result = summarize([validate_holding(dict(symbol="AAA", shares="2", average_cost="4", price="0"))])
        self.assertEqual(result["holdings"][0]["allocation"], "0.00")
        self.assertEqual(result["unrealized"], "-8.00")
        self.assertEqual(summarize([])["value"], "0.00")

    def test_half_cent_rounding(self):
        result = summarize([validate_holding(dict(symbol="AAA", shares="0.1", average_cost="0", price="0.15"))])
        self.assertEqual(result["value"], "0.02")

    def test_invalid_inputs(self):
        for value in ["NaN", "Infinity", "-1", True, [], "1e100", "0.0000001"]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_holding(dict(symbol="AAA", shares=value, average_cost="1", price="1"))
        with self.assertRaises(ValueError):
            validate_holding(dict(symbol="<script>", shares="1", average_cost="1", price="1"))


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.db_path = Path(self.directory.name) / "test.sqlite3"
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(self.db_path))
        self.origin = f"http://127.0.0.1:{self.server.server_port}"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.directory.cleanup()

    def request(self, path, data=None, **headers):
        body = json.dumps(data).encode() if data is not None else None
        request = urllib.request.Request(self.origin + path, data=body,
            headers={"Content-Type": "application/json", "Origin": self.origin, **headers})
        with urllib.request.urlopen(request) as response:
            return json.load(response)

    def test_save_replace_persist_remove(self):
        data = dict(symbol="abc", shares="2.5", average_cost="10", price="12")
        self.request("/api/holding", data)
        self.request("/api/holding", {**data, "price": "8"})
        result = self.request("/api/portfolio")
        self.assertEqual(len(result["holdings"]), 1)
        self.assertEqual(result["unrealized"], "-5.00")
        with connect(self.db_path) as reopened:
            self.assertEqual(reopened.execute("SELECT price FROM holdings WHERE symbol='ABC'").fetchone()[0], "8")
        self.request("/api/remove", dict(symbol="ABC"))
        self.assertEqual(self.request("/api/portfolio")["holdings"], [])

    def test_foreign_origin_rejected(self):
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.request("/api/holding", {}, Origin="https://example.com")
        self.assertEqual(caught.exception.code, 403)

    def test_unexpected_host_rejected(self):
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.request("/api/portfolio", Host="attacker.example")
        self.assertEqual(caught.exception.code, 403)

    def test_invalid_holding_rejected(self):
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.request("/api/holding", dict(symbol="AAA", shares="-1", average_cost="1", price="1"))
        self.assertEqual(caught.exception.code, 400)


if __name__ == "__main__":
    unittest.main()
