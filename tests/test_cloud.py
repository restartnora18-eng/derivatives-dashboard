import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import build_site
import cloud_update
import collect_funding


class CloudTests(unittest.TestCase):
    def setUp(self):
        minute_patcher=patch.object(cloud_update.collect_oi_minutes,"collect",return_value={"states":{"oi":{"status":"ok"},"prices":{"status":"ok"}}})
        minute_patcher.start()
        self.addCleanup(minute_patcher.stop)
        positions_patcher = patch.object(cloud_update.collect_option_positions, "collect", return_value={"states":{"BTC":{"status":"ok"}}})
        positions_patcher.start()
        self.addCleanup(positions_patcher.stop)
        patcher = patch.object(cloud_update.collect_oi, "collect", return_value={"states":{"BTC":{"status":"ok"}}})
        price_patcher = patch.object(cloud_update.collect_price, "collect", return_value={"states":{"BTC":{"status":"ok"}}})
        basis_patcher = patch.object(cloud_update.collect_basis, "collect", return_value={"states":{"BTC":{"status":"ok"}}})
        basis_patcher.start()
        self.addCleanup(basis_patcher.stop)
        futures_patcher = patch.object(cloud_update.collect_futures, "collect", return_value={"states":{"BTC":{"status":"ok"}}})
        futures_patcher.start()
        self.addCleanup(futures_patcher.stop)
        options_patcher = patch.object(cloud_update.collect_options, "collect", return_value={"states":{"BTC":{"status":"ok"}}})
        options_patcher.start()
        self.addCleanup(options_patcher.stop)
        book_patcher = patch.object(cloud_update.collect_orderbook, "collect", return_value={"states":{"BTC":{"status":"ok"}}})
        book_patcher.start()
        self.addCleanup(book_patcher.stop)
        liq_patcher = patch.object(cloud_update.collect_liquidations, "collect", return_value={"states":{"BTC":{"status":"ok"}}})
        liq_patcher.start()
        self.addCleanup(liq_patcher.stop)
        price_patcher.start()
        self.addCleanup(price_patcher.stop)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_static_build_excludes_collectors_audits_and_private_extra_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in build_site.PUBLIC_FILES:
                (root / name).write_text('<script src="runtime-config.js"></script>' if name == "index.html" else "test", encoding="utf-8")
            (root / "private-notes.txt").write_text("do not publish")
            (root / "collect_funding.py").write_text("do not publish")
            dist = build_site.build_site(root, hosted=True)
            self.assertEqual(set(p.name for p in dist.iterdir()), set(build_site.PUBLIC_FILES) | {"runtime-config.js", ".nojekyll"})
            self.assertIn('"hosted": true', (dist / "runtime-config.js").read_text())
            self.assertFalse((dist / "private-notes.txt").exists())
            # A second build clears old generated assets, never arbitrary project files.
            (dist / "obsolete.js").write_text("old")
            build_site.build_site(root)
            self.assertFalse((dist / "obsolete.js").exists())
            self.assertTrue((root / "private-notes.txt").exists())

    def test_build_rejects_missing_or_unlisted_assets(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in build_site.PUBLIC_FILES:
                (root / name).write_text('<script src="secret.js"></script>' if name == "index.html" else "test")
            with self.assertRaises(ValueError):
                build_site.build_site(root)

    def test_dist_symlink_is_not_a_deletion_target(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "keep").mkdir()
            (root / "dist").symlink_to(root / "keep", target_is_directory=True)
            with self.assertRaises(ValueError):
                build_site.build_site(root)
            self.assertTrue((root / "keep").is_dir())

    def test_history_runs_only_when_due_or_all_previously_failed(self):
        now = datetime(2026, 10, 25, 12, tzinfo=timezone.utc)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "data/settled/last-attempt.json"
            path.parent.mkdir(parents=True)
            (root / "history-data.js").write_text("test")
            self.assertTrue(cloud_update.history_due(root, now))
            path.write_text(json.dumps({"collected_at":"2026-10-25T08:00:00Z","series":{"okx:BTC":{}}}))
            self.assertFalse(cloud_update.history_due(root, now))
            path.write_text(json.dumps({"collected_at":"2026-10-25T04:00:00Z","series":{"okx:BTC":{}}}))
            self.assertTrue(cloud_update.history_due(root, now))
            path.write_text(json.dumps({"collected_at":"2026-10-25T11:00:00Z","series":{}}))
            self.assertTrue(cloud_update.history_due(root, now))

    def test_failed_collection_keeps_health_status_for_final_workflow_check(self):
        original_age = collect_funding.MAX_SOURCE_AGE_SECONDS
        with tempfile.TemporaryDirectory() as directory:
            empty = {"records":[],"venues":{}}
            with patch.object(cloud_update.collect_funding,"collect",return_value=empty), \
                 patch.object(cloud_update.collect_funding,"save_run",return_value=False), \
                 patch.object(cloud_update,"history_due",return_value=False):
                report = cloud_update.update(directory)
            self.assertEqual(report["funding"], "failed")
            self.assertEqual(report["history"], "skipped")
            saved = json.loads((Path(directory)/"data/cloud-status.json").read_text())
            self.assertEqual(saved["funding"], "failed")
            self.assertEqual(collect_funding.MAX_SOURCE_AGE_SECONDS, original_age)

    def test_cloud_uses_ninety_minutes_and_still_exits(self):
        with tempfile.TemporaryDirectory() as directory:
            observed = []
            def collect():
                observed.append(collect_funding.MAX_SOURCE_AGE_SECONDS)
                return {"records":[],"venues":{}}
            with patch.object(cloud_update.collect_funding,"collect",side_effect=collect), \
                 patch.object(cloud_update.collect_funding,"save_run",return_value=True), \
                 patch.object(cloud_update,"history_due",return_value=False):
                report = cloud_update.update(directory)
            self.assertEqual(observed, [5400])
            self.assertEqual(report["funding"], "available")


if __name__ == "__main__":
    unittest.main()
