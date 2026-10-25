"""On-demand, bounded public funding settlement history. Standard library only."""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from collect_funding import (BASES, VENUES, ROOT, DataError, atomic_text,
                            finite_number, get_json, parse_time, serialize, timestamp_ms, utc_now)

HISTORY_ENDPOINTS = {
    "binance": "https://fapi.binance.com/fapi/v1/fundingRate",
    "bybit": "https://api.bybit.com/v5/market/funding/history",
    "okx": "https://www.okx.com/api/v5/public/funding-rate-history",
    "bitget": "https://api.bitget.com/api/v3/market/history-fund-rate",
}
MAX_PAGES = 8


def extract_page(venue, payload):
    if venue == "binance":
        result = payload
    elif not isinstance(payload, dict):
        raise DataError("invalid_response", "历史接口顶层响应异常")
    elif venue == "bybit":
        if payload.get("retCode") != 0:
            raise DataError("api_error", "Bybit 历史接口业务错误")
        result = payload.get("result")
        result = result.get("list") if isinstance(result, dict) else None
    else:
        if payload.get("code") != ("0" if venue == "okx" else "00000"):
            raise DataError("api_error", venue + " 历史接口业务错误")
        result = payload.get("data")
        if venue == "bitget":
            result = result.get("resultList") if isinstance(result, dict) else None
    if not isinstance(result, list):
        raise DataError("invalid_response", "历史接口未返回记录列表")
    return result


def normalize_point(venue, base, item):
    if not isinstance(item, dict):
        raise DataError("invalid_record", "记录不是对象")
    symbol = base + "-USDT-SWAP" if venue == "okx" else base + "USDT"
    if item.get("instId" if venue == "okx" else "symbol") != symbol:
        raise DataError("wrong_contract", "历史记录合约不匹配")
    time_field = "fundingTime" if venue in ("binance", "okx") else "fundingRateTimestamp"
    # OKX distinguishes projected fundingRate from actual realizedRate.
    # Do not silently substitute its forecast for an actual settlement.
    rate_field = "realizedRate" if venue == "okx" else "fundingRate"
    if venue == "binance" and item.get("rateType", "Regular") != "Regular":
        raise DataError("non_regular_rate", "非普通资金费率事件不纳入图表")
    stamp = timestamp_ms(item.get(time_field))
    if stamp is None:
        raise DataError("invalid_time", "历史结算时间缺失或异常")
    rate = finite_number(item.get(rate_field))
    return {"settled_at": stamp, "rate_decimal": rate, "rate_percent": finite_number(rate * 100),
            "raw_rate": str(item[rate_field]), "source_rate_field": rate_field,
            "raw_record": item}


def point_ms(point):
    return int(parse_time(point["settled_at"]).timestamp() * 1000)


def request_params(venue, symbol, start_ms, end_ms, page, cursor):
    if venue == "binance":
        return {"symbol": symbol, "startTime": cursor or start_ms, "endTime": end_ms, "limit": 1000}
    if venue == "bybit":
        return {"symbol": symbol, "category": "linear", "startTime": start_ms,
                "endTime": cursor if cursor is not None else end_ms, "limit": 200}
    if venue == "okx":
        return {"instId": symbol, "limit": 100, **({"after": str(cursor)} if cursor is not None else {})}
    return {"symbol": symbol, "category": "USDT-FUTURES", "limit": 100, "cursor": str(page)}


def fetch_history(venue, base, start_ms, end_ms, getter=get_json):
    symbol = base + "-USDT-SWAP" if venue == "okx" else base + "USDT"
    points, audit, warnings = {}, [], []
    cursor = None
    previous_frontier = None
    skipped = 0
    reached_start = False
    exhausted = False
    for page in range(1, MAX_PAGES + 1):
        params = request_params(venue, symbol, start_ms, end_ms, page, cursor)
        try:
            payload = getter(HISTORY_ENDPOINTS[venue], params)
            raw_rows = extract_page(venue, payload)
        except DataError as exc:
            if not audit:
                raise
            warnings.append({"code": exc.code, "message": "翻页失败，保留本次已取得的历史记录"})
            break
        audit.append({"params": params, "response": payload})
        if not raw_rows:
            exhausted = True
            break
        normalized = []
        for item in raw_rows:
            try:
                normalized.append(normalize_point(venue, base, item))
            except DataError:
                skipped += 1
        if not normalized:
            warnings.append({"code": "invalid_page", "message": "本页没有可验证的已结算费率"})
            break
        for point in normalized:
            timestamp = point_ms(point)
            if start_ms <= timestamp <= end_ms:
                existing = points.get(point["settled_at"])
                if existing and existing["rate_decimal"] != point["rate_decimal"]:
                    warnings.append({"code": "conflicting_duplicate", "message": "同一结算时刻出现不同费率，保留首次响应"})
                else:
                    points[point["settled_at"]] = point
        oldest, newest = min(map(point_ms, normalized)), max(map(point_ms, normalized))
        reached_start = reached_start or oldest <= start_ms
        if venue == "binance":
            frontier = newest
            done = newest >= end_ms
            cursor = newest + 1
            stalled = previous_frontier is not None and frontier <= previous_frontier
        else:
            frontier = oldest
            done = reached_start
            cursor = oldest - 1 if venue == "bybit" else oldest
            stalled = previous_frontier is not None and frontier >= previous_frontier
        if stalled:
            warnings.append({"code": "pagination_stalled", "message": "翻页未向目标时间推进，停止重复请求"})
            break
        previous_frontier = frontier
        if done:
            break
        limit = params["limit"]
        if len(raw_rows) < limit:
            exhausted = True
            break
        if page == MAX_PAGES:
            warnings.append({"code": "page_limit", "message": "已达每合约分页上限，覆盖范围可能不足"})
    if skipped:
        warnings.append({"code": "invalid_records", "message": f"跳过 {skipped} 条未能核验的记录"})
    ordered = sorted(points.values(), key=lambda p: p["settled_at"])
    if not ordered:
        warnings.append({"code": "empty_range", "message": "查询时间范围内无可验证记录"})
    return {"venue": venue, "base": base, "symbol": symbol,
            "rate_kind": "settled", "rate_unit": "percent_per_settlement",
            "collected_at": utc_now(), "requested_start": timestamp_ms(start_ms),
            "requested_end": timestamp_ms(end_ms), "points": ordered,
            "coverage": {"first": ordered[0]["settled_at"] if ordered else None,
                         "last": ordered[-1]["settled_at"] if ordered else None,
                         "reached_requested_start": reached_start, "source_exhausted": exhausted},
            "warnings": warnings, "source_endpoint": HISTORY_ENDPOINTS[venue], "audit_pages": audit}


def collect_history(days=30, getter=get_json, end=None):
    end = end or datetime.now(timezone.utc)
    end_ms = int(end.timestamp() * 1000)
    start_ms = int((end - timedelta(days=days)).timestamp() * 1000)
    series, statuses = {}, {}
    for venue in VENUES:
        errors, count, warned = [], 0, False
        for index, base in enumerate(BASES):
            try:
                result = fetch_history(venue, base, start_ms, end_ms, getter)
                if result["points"]:
                    series[f"{venue}:{base}"] = result
                    count += len(result["points"])
                else:
                    errors.append({"base": base, "code": "empty_range", "message": "范围内无已结算记录"})
                warned = warned or bool(result["warnings"])
            except DataError as exc:
                errors.append({"base": base, "code": exc.code, "message": str(exc)})
                if exc.code in ("http_403", "http_451"):
                    for skipped in BASES[index + 1:]:
                        errors.append({"base": skipped, "code": exc.code, "message": "访问受限，跳过重复请求"})
                    break
            except (KeyError, TypeError, ValueError, AttributeError):
                errors.append({"base": base, "code": "invalid_response", "message": "历史响应字段结构异常"})
        statuses[venue] = {"status": "failed" if not count else "partial" if errors else "warning" if warned else "ok",
                           "received": count, "errors": errors}
    return {"schema_version": 1, "collected_at": utc_now(), "days": days,
            "requested_start": timestamp_ms(start_ms), "requested_end": timestamp_ms(end_ms),
            "series": series, "venues": statuses}


def save_history(attempt, root=ROOT):
    root = Path(root)
    data_dir = root / "data" / "settled"
    data_dir.mkdir(parents=True, exist_ok=True)
    path = data_dir / "latest.json"
    previous = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"series": {}}
    combined = dict(previous["series"])
    # Keep a contract's old history on a failed attempt, with its own unchanged date.
    combined.update(attempt["series"])
    latest = {"schema_version": 1, "series": combined}
    archive = data_dir / "attempts"
    archive.mkdir(exist_ok=True)
    name = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H%M%S.%fZ.json")
    with (archive / name).open("x", encoding="utf-8") as handle:
        handle.write(serialize(attempt))
    atomic_text(path, serialize(latest))
    atomic_text(data_dir / "last-attempt.json", serialize(attempt))
    # Keep raw response pages on disk; send only chart data and provenance to the browser.
    compact = {key: {k: v for k, v in series.items() if k != "audit_pages"}
               for key, series in combined.items()}
    for series in compact.values():
        series["points"] = [{k: v for k, v in point.items() if k != "raw_record"} for point in series["points"]]
    summary = {k: v for k, v in attempt.items() if k != "series"}
    payload = serialize({"series": compact, "last_attempt": summary}).replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    atomic_text(root / "history-data.js", "// Generated from public settled funding endpoints.\nwindow.FUNDING_HISTORY = " + payload.rstrip() + ";\n")
    return bool(attempt["series"])


def main():
    parser = argparse.ArgumentParser(description="一次性采集 BTC/ETH 最近 30 天已结算资金费率")
    parser.add_argument("--output-dir", type=Path, default=ROOT)
    args = parser.parse_args()
    attempt = collect_history()
    success = save_history(attempt, args.output_dir)
    for venue, status in attempt["venues"].items():
        print(f"{venue}: {status['status']} / {status['received']} settlements")
    print("历史文件已更新；没有后台进程。")
    return 0 if success else 1


if __name__ == "__main__":
    raise SystemExit(main())
