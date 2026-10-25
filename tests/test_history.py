"""History semantics and failure modes; fixtures are synthetic, not published."""
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from collect_funding import DataError
import collect_history as history

END = int(datetime(2026, 10, 25, 4, tzinfo=timezone.utc).timestamp() * 1000)
START = END - 30 * 86400000


def row(timestamp, rate="0.0001", venue="okx", base="BTC"):
    if venue == "okx":
        return {"instId": base + "-USDT-SWAP", "fundingTime": str(timestamp),
                "fundingRate": "0.0099", "realizedRate": rate}
    return {"symbol": base + "USDT", "fundingTime" if venue == "binance" else "fundingRateTimestamp": str(timestamp), "fundingRate": rate}


def payload(rows, venue="okx"):
    if venue == "binance":
        return rows
    if venue == "bybit":
        return {"retCode": 0, "result": {"list": rows}}
    return {"code": "0" if venue == "okx" else "00000",
            "data": rows if venue == "okx" else {"resultList": rows}}


def attempt(series):
    return {"schema_version": 1, "collected_at": "2026-10-25T04:00:00Z", "days": 30,
            "requested_start": history.timestamp_ms(START), "requested_end": history.timestamp_ms(END),
            "series": series, "venues": {}}


class HistoryTests(unittest.TestCase):
    def test_actual_okx_rate_not_forecast(self):
        point = history.normalize_point("okx", "BTC", row(END, "0"))
        self.assertEqual(point["rate_percent"], 0)
        self.assertEqual(point["source_rate_field"], "realizedRate")
        invalid = row(END)
        del invalid["realizedRate"]
        with self.assertRaises(DataError):
            history.normalize_point("okx", "BTC", invalid)

    def test_four_exchanges_keep_zero_and_negative_settlements(self):
        for venue in history.VENUES:
            with self.subTest(venue=venue):
                point = history.normalize_point(venue, "BTC", row(END, "-0.0001", venue))
                self.assertAlmostEqual(point["rate_percent"], -0.01)
                self.assertEqual(history.normalize_point(venue, "BTC", row(END, "0", venue))["rate_percent"], 0)

    def test_unverifiable_wrong_symbol_and_special_rate_rejected(self):
        for bad in (None, "", "NaN", "Infinity"):
            with self.subTest(rate=bad), self.assertRaises(DataError):
                history.normalize_point("okx", "BTC", row(END, bad))
        with self.assertRaises(DataError):
            history.normalize_point("okx", "BTC", row(END, base="ETH"))
        special = row(END, venue="binance")
        special["rateType"] = "Special"
        with self.assertRaises(DataError):
            history.normalize_point("binance", "BTC", special)

    def test_filter_future_and_out_of_range_sort_dedup(self):
        rows = [row(END - 3600000, "0"), row(END + 3600000), row(START - 3600000),
                row(END - 7200000, "-0.0001"), row(END - 3600000, "0")]
        result = history.fetch_history("okx", "BTC", START, END, lambda *_: payload(rows))
        self.assertEqual([p["rate_percent"] for p in result["points"]], [-0.01, 0])
        self.assertTrue(result["coverage"]["reached_requested_start"])

    def test_conflicting_duplicates_are_flagged_not_added(self):
        result = history.fetch_history("okx", "BTC", START, END,
            lambda *_: payload([row(END, "0"), row(END, "0.0001")]))
        self.assertEqual(len(result["points"]), 1)
        self.assertEqual(result["points"][0]["rate_percent"], 0)
        self.assertIn("conflicting_duplicate", [w["code"] for w in result["warnings"]])

    def test_okx_paginates_older_and_stops_on_range_boundary(self):
        calls = []
        first = [row(END - n * 3600000) for n in range(100)]
        second = [row(START - 1)]
        def getter(url, params):
            calls.append(dict(params))
            return payload(first if len(calls) == 1 else second)
        result = history.fetch_history("okx", "BTC", START, END, getter)
        self.assertEqual(calls[1]["after"], str(END - 99 * 3600000))
        self.assertEqual(len(result["points"]), 100)
        self.assertTrue(result["coverage"]["reached_requested_start"])

    def test_bitget_cursor_is_page_number(self):
        calls = []
        def getter(url, params):
            calls.append(params["cursor"])
            return payload([row(END - n * 3600000, venue="bitget") for n in range(100)]
                           if len(calls) == 1 else [], "bitget")
        history.fetch_history("bitget", "BTC", START, END, getter)
        self.assertEqual(calls, ["1", "2"])

    def test_repeated_page_stops_instead_of_looping(self):
        rows = [row(END - n * 3600000) for n in range(100)]
        result = history.fetch_history("okx", "BTC", START, END, lambda *_: payload(rows))
        self.assertEqual(len(result["audit_pages"]), 2)
        self.assertIn("pagination_stalled", [w["code"] for w in result["warnings"]])

    def test_page_failure_retains_partial_and_marks_it(self):
        count = 0
        def getter(*args):
            nonlocal count
            count += 1
            if count > 1:
                raise DataError("network_error", "failed")
            return payload([row(END - n * 3600000) for n in range(100)])
        result = history.fetch_history("okx", "BTC", START, END, getter)
        self.assertEqual(len(result["points"]), 100)
        self.assertIn("network_error", [w["code"] for w in result["warnings"]])

    def test_access_denial_skips_second_contract(self):
        calls = []
        def getter(url, params):
            calls.append(url)
            raise DataError("http_451", "restricted")
        result = history.collect_history(getter=getter)
        self.assertEqual(len(calls), 4)
        self.assertEqual(result["series"], {})
        self.assertTrue(all(len(s["errors"]) == 2 for s in result["venues"].values()))

    def test_all_failed_attempt_retains_old_history_with_original_timestamp(self):
        series = history.fetch_history("okx", "BTC", START, END, lambda *_: payload([row(END)]))
        with tempfile.TemporaryDirectory() as directory:
            history.save_history(attempt({"okx:BTC": series}), directory)
            failed = attempt({})
            failed["collected_at"] = "2026-10-26T04:00:00Z"
            history.save_history(failed, directory)
            latest = json.loads((Path(directory) / "data/settled/latest.json").read_text())
            self.assertEqual(latest["series"]["okx:BTC"]["collected_at"], series["collected_at"])
            browser = (Path(directory) / "history-data.js").read_text()
            self.assertNotIn('"audit_pages"', browser)
            self.assertNotIn('"raw_record"', browser)
            self.assertIn('2026-10-26T04:00:00Z', browser)


if __name__ == "__main__":
    unittest.main()
