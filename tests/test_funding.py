"""Deterministic tests: synthetic API-shaped inputs, never published as market data."""
import copy
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

import collect_funding as funding

NOW = "2026-10-25T04:00:00.000Z"
TS = int(datetime(2026, 10, 25, 4, tzinfo=timezone.utc).timestamp() * 1000)


def okx_payload(rate="0.0001", hours=8):
    return {"code": "0", "data": [{"instId": "BTC-USDT-SWAP", "fundingRate": rate,
        "fundingTime": str(TS + 3600000), "nextFundingTime": str(TS + (1 + hours) * 3600000), "ts": str(TS)}]}


def snapshot(rows):
    return {"schema_version": 2, "captured_at": NOW, "records": rows,
        "venues": {venue: {"status": "ok" if any(r["venue"] == venue for r in rows) else "failed",
            "received": sum(r["venue"] == venue for r in rows), "expected": 2, "errors": []}
            for venue in funding.VENUES}}


class FundingTests(unittest.TestCase):
    def test_annualization_uses_actual_interval(self):
        self.assertAlmostEqual(funding.annualize("0.0001", 8), 10.95)
        self.assertAlmostEqual(funding.annualize("0.0001", 4), 21.9)
        self.assertAlmostEqual(funding.annualize("-0.0001", 1), -87.6)

    def test_zero_rate_is_valid(self):
        row = funding.normalize("okx", "BTC", okx_payload("0"), fetched_at=NOW)
        self.assertEqual(row["rate_percent"], 0)
        self.assertEqual(row["annualized_percent"], 0)
        self.assertEqual(row["warnings"], [])

    def test_unknown_or_invalid_interval_has_no_annualization(self):
        for interval in (None, "", "NaN", 0, -8, 100, True):
            with self.subTest(interval=interval):
                self.assertIsNone(funding.annualize(0.0001, interval))

    def test_invalid_rates_are_rejected(self):
        for rate in (None, "", "NaN", "Infinity", "text", True):
            with self.subTest(rate=rate), self.assertRaises(funding.DataError):
                funding.normalize("okx", "BTC", okx_payload(rate), fetched_at=NOW)

    def test_okx_uses_period_between_settlement_timestamps(self):
        row = funding.normalize("okx", "BTC", okx_payload(hours=4), fetched_at=NOW)
        self.assertEqual(row["interval_hours"], 4)
        self.assertAlmostEqual(row["annualized_percent"], 21.9)
        self.assertEqual(row["funding_time"], funding.timestamp_ms(TS + 3600000))
        self.assertEqual(row["rate_kind"], "estimated_upcoming")

    def test_reversed_okx_timestamps_are_not_assumed_eight_hours(self):
        row = funding.normalize("okx", "BTC", okx_payload(hours=-4), fetched_at=NOW)
        self.assertIsNone(row["annualized_percent"])
        self.assertIn("interval_unknown", row["warnings"])

    def test_binance_missing_adjustment_is_not_default_eight_hours(self):
        payload = {"symbol": "BTCUSDT", "lastFundingRate": "0.0001", "time": TS,
                   "nextFundingTime": TS + 3600000}
        row = funding.normalize("binance", "BTC", payload, [], NOW)
        self.assertIsNone(row["annualized_percent"])
        known = funding.normalize("binance", "BTC", payload,
            [{"symbol": "BTCUSDT", "fundingIntervalHours": 4}], NOW)
        self.assertAlmostEqual(known["annualized_percent"], 21.9)

    def test_bybit_minutes_are_converted_to_hours(self):
        payload = {"retCode": 0, "time": TS, "result": {"list": [
            {"symbol": "BTCUSDT", "fundingRate": "0.0001", "nextFundingTime": str(TS + 3600000)}]}}
        metadata = {"retCode": 0, "result": {"list": [{"symbol": "BTCUSDT", "fundingInterval": 240,
            "contractType": "LinearPerpetual", "settleCoin": "USDT"}]}}
        row = funding.normalize("bybit", "BTC", payload, metadata, NOW)
        self.assertEqual(row["interval_hours"], 4)
        self.assertAlmostEqual(row["annualized_percent"], 21.9)

    def test_bybit_ticker_interval_is_used(self):
        payload = {"retCode": 0, "time": TS, "result": {"list": [{"symbol": "BTCUSDT",
            "fundingRate": "0", "fundingIntervalHour": "1", "nextFundingTime": str(TS + 3600000)}]}}
        self.assertEqual(funding.normalize("bybit", "BTC", payload, fetched_at=NOW)["interval_hours"], 1)

    def test_bitget_retains_raw_rate_and_interval(self):
        payload = {"code": "00000", "requestTime": TS, "data": [{"symbol": "BTCUSDT",
            "fundingRate": "-0.000088", "fundingRateInterval": "8", "nextUpdate": str(TS + 3600000)}]}
        row = funding.normalize("bitget", "BTC", payload, fetched_at=NOW)
        self.assertEqual(row["raw_rate"], "-0.000088")
        self.assertAlmostEqual(row["rate_percent"], -0.0088)
        self.assertEqual(row["raw_response"], payload)

    def test_missing_wrong_or_duplicate_contract_rejected(self):
        for records in ([], [{"instId": "ETH-USDT-SWAP"}], okx_payload()["data"] * 2):
            with self.subTest(records=records), self.assertRaises(funding.DataError):
                funding.normalize("okx", "BTC", {"code": "0", "data": records}, fetched_at=NOW)

    def test_api_business_error_is_failure(self):
        with self.assertRaises(funding.DataError):
            funding.normalize("bybit", "BTC", {"retCode": 10001}, fetched_at=NOW)

    def test_stale_future_and_missing_source_times_flagged(self):
        for value, expected in ((TS - 3600000, "source_stale"),
                                (TS + 600000, "source_time_in_future"), ("", "source_time_missing")):
            payload = okx_payload()
            payload["data"][0]["ts"] = value
            row = funding.normalize("okx", "BTC", payload, fetched_at=NOW)
            self.assertIn(expected, row["warnings"])

    def test_http_access_denial_stops_duplicate_requests(self):
        calls = []
        def denied(url, params=None):
            calls.append(url)
            raise funding.DataError("http_403", "HTTP 403")
        result = funding.collect(denied)
        self.assertEqual(len(calls), 4)
        self.assertEqual(result["records"], [])
        self.assertTrue(all(len(state["errors"]) == 2 for state in result["venues"].values()))

    def test_all_failed_preserves_last_snapshot_but_updates_attempt(self):
        row = funding.normalize("okx", "BTC", okx_payload(), fetched_at=NOW)
        with tempfile.TemporaryDirectory() as directory:
            self.assertTrue(funding.save_run(snapshot([row]), directory))
            path = Path(directory) / "data/latest.json"
            before = path.read_bytes()
            failure = snapshot([])
            failure["captured_at"] = "2026-10-25T05:00:00.000Z"
            self.assertFalse(funding.save_run(failure, directory))
            self.assertEqual(path.read_bytes(), before)
            bundle = (Path(directory) / "funding-data.js").read_text()
            parsed = json.loads(bundle.split("window.FUNDING_DATA = ", 1)[1].rstrip().removesuffix(";"))
            self.assertEqual(len(parsed["snapshot"]["records"]), 1)
            self.assertEqual(parsed["last_attempt"]["records"], [])

    def test_first_failed_run_does_not_create_fake_latest(self):
        with tempfile.TemporaryDirectory() as directory:
            funding.save_run(snapshot([]), directory)
            self.assertFalse((Path(directory) / "data/latest.json").exists())
            self.assertTrue((Path(directory) / "funding-data.js").exists())

    def test_history_does_not_overwrite_same_minute(self):
        data = snapshot([funding.normalize("okx", "BTC", okx_payload(), fetched_at=NOW)])
        with tempfile.TemporaryDirectory() as directory:
            funding.save_run(data, directory)
            funding.save_run(data, directory)
            self.assertEqual(len(list((Path(directory) / "data/history").glob("*.json"))), 2)

    def test_invalid_calculation_is_rejected_before_writing(self):
        data = snapshot([funding.normalize("okx", "BTC", okx_payload(), fetched_at=NOW)])
        data["records"][0]["annualized_percent"] = 1095
        with tempfile.TemporaryDirectory() as directory, self.assertRaises(ValueError):
            funding.save_run(data, directory)


if __name__ == "__main__":
    unittest.main()
