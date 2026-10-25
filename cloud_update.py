"""One cloud refresh. History refreshes only when due; no local scheduler."""
from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path

import collect_funding
import collect_history
import collect_oi
import collect_price
import collect_basis
import collect_futures
import collect_options
import collect_orderbook
import collect_liquidations
from collect_funding import atomic_text, parse_time, serialize, utc_now

ROOT = Path(__file__).resolve().parent


def history_due(root=ROOT, now=None):
    root = Path(root)
    path = root / "data/settled/last-attempt.json"
    if not path.exists() or not (root / "history-data.js").exists():
        return True
    try:
        previous = json.loads(path.read_text(encoding="utf-8"))
        age = ((now or datetime.now(timezone.utc)) - parse_time(previous["collected_at"])).total_seconds()
        return age < 0 or age >= 8 * 3600 or not previous.get("series")
    except (ValueError, KeyError, TypeError):
        return True


def update(root=ROOT, force_history=False):
    root = Path(root)
    report = {"attempted_at": utc_now(), "funding": "failed", "history": "skipped", "errors": []}
    previous_max_age = collect_funding.MAX_SOURCE_AGE_SECONDS
    try:
        # Hourly cloud cadence: flag observations older than 90 minutes, not 30.
        collect_funding.MAX_SOURCE_AGE_SECONDS = 90 * 60
        snapshot = collect_funding.collect()
        report["funding"] = "available" if collect_funding.save_run(snapshot, root) else "failed"
        report["funding_venues"] = snapshot["venues"]
    except Exception as exc:
        report["errors"].append({"module": "funding", "type": type(exc).__name__})
    finally:
        collect_funding.MAX_SOURCE_AGE_SECONDS = previous_max_age
    if force_history or history_due(root):
        try:
            history = collect_history.collect_history()
            report["history"] = "available" if collect_history.save_history(history, root) else "failed"
            report["history_venues"] = history["venues"]
        except Exception as exc:
            report["history"] = "failed"
            report["errors"].append({"module": "history", "type": type(exc).__name__})
    try:
        oi = collect_oi.collect(root)
        report["oi"] = "available" if any(s["status"] == "ok" for s in oi["states"].values()) else "failed"
    except Exception as exc:
        report["oi"] = "failed"
        report["errors"].append({"module":"oi", "type":type(exc).__name__})
    try:
        prices = collect_price.collect(root)
        report["price"] = "available" if any(s["status"] == "ok" for s in prices["states"].values()) else "failed"
    except Exception as exc:
        report["price"] = "failed"
        report["errors"].append({"module":"price", "type":type(exc).__name__})
    try:
        basis = collect_basis.collect(root)
        report["basis"] = "available" if any(s["status"] == "ok" for s in basis["states"].values()) else "failed"
    except Exception as exc:
        report["basis"] = "failed"
        report["errors"].append({"module":"basis", "type":type(exc).__name__})
    try:
        futures = collect_futures.collect(root)
        report["futures"] = "available" if any(s["status"] in ("ok", "partial") for s in futures["states"].values()) else "failed"
    except Exception as exc:
        report["futures"] = "failed"
        report["errors"].append({"module":"futures", "type":type(exc).__name__})
    try:
        options = collect_options.collect(root)
        report["options"] = "available" if any(s["status"] == "ok" for s in options["states"].values()) else "failed"
    except Exception as exc:
        report["options"] = "failed"
        report["errors"].append({"module":"options", "type":type(exc).__name__})
    try:
        book = collect_orderbook.collect(root)
        report["orderbook"] = "available" if any(s["status"] == "ok" for s in book["states"].values()) else "failed"
    except Exception as exc:
        report["orderbook"] = "failed"
        report["errors"].append({"module":"orderbook", "type":type(exc).__name__})
    try:
        liq = collect_liquidations.collect(root)
        report["liquidations"] = "experimental_available" if any(s["status"] == "ok" for s in liq["states"].values()) else "failed"
    except Exception as exc:
        report["liquidations"] = "failed"
        report["errors"].append({"module":"liquidations", "type":type(exc).__name__})
    atomic_text(root / "data/cloud-status.json", serialize(report))
    return report


def summary(report):
    lines = ["## 衍生观察云端更新", "", f"- UTC: {report['attempted_at']}",
             f"- 当前费率: {report['funding']}", f"- 未平仓量: {report.get('oi', '尚未运行')}", f"- 标记价格: {report.get('price', '尚未运行')}", f"- 永续溢价: {report.get('basis', '尚未运行')}", f"- 交割基差: {report.get('futures', '尚未运行')}", f"- 期权: {report.get('options', '尚未运行')}", f"- 盘口: {report.get('orderbook', '尚未运行')}", f"- 强平样本: {report.get('liquidations', '尚未运行')}", f"- 已结算历史: {report['history']}",
             "- 部分交易所受限时，网页会保留相应状态；不绕过限制。", ""]
    for module in ("funding", "history"):
        for venue, state in report.get(module + "_venues", {}).items():
            errors = ", ".join(sorted({e["code"] for e in state.get("errors", [])}))
            lines.append(f"- {module} / {venue}: {state['status']} ({state['received']}) {errors}")
    return "\n".join(lines) + "\n"


def main():
    parser = argparse.ArgumentParser(description="供 GitHub Actions 调用的一次更新")
    parser.add_argument("--force-history", action="store_true")
    parser.add_argument("--check-health", action="store_true", help="检查已保存状态，不发送网络请求")
    args = parser.parse_args()
    if args.check_health:
        report = json.loads((ROOT / "data/cloud-status.json").read_text(encoding="utf-8"))
        print(summary(report))
        return int(report.get("liquidations") == "failed" or report.get("orderbook") == "failed" or report.get("options") == "failed" or report.get("futures") == "failed" or report.get("basis") == "failed" or report.get("price") == "failed" or report.get("oi") == "failed" or report["funding"] == "failed" or report["history"] == "failed" or bool(report["errors"]))
    report = update(force_history=args.force_history)
    message = summary(report)
    print(message)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as handle:
            handle.write(message)
    # Persist and publish failure states first; the workflow checks health last.
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
