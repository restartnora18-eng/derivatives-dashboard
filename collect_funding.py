"""Small public-data collector. Python 3.9+, standard library only.

Run once, then exit. No account credentials, trading calls, or scheduler.
Inspired by ruleaker/perp-funding-screener's snapshot architecture (MIT).
"""
from __future__ import annotations

import argparse
import json
import math
import os
import socket
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
VENUES = ("binance", "bybit", "okx", "bitget")
BASES = ("BTC", "ETH")
MAX_SOURCE_AGE_SECONDS = 1800
ENDPOINTS = {
    "binance": "https://fapi.binance.com/fapi/v1/premiumIndex",
    "bybit": "https://api.bybit.com/v5/market/tickers",
    "okx": "https://www.okx.com/api/v5/public/funding-rate",
    "bitget": "https://api.bitget.com/api/v3/market/current-fund-rate",
}


class DataError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def timestamp_ms(value):
    try:
        number = float(value)
        if not math.isfinite(number) or number <= 0 or isinstance(value, bool):
            return None
        return datetime.fromtimestamp(number / 1000, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    except (TypeError, ValueError, OverflowError, OSError):
        return None


def parse_time(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def finite_number(value):
    if isinstance(value, bool) or value is None or value == "":
        raise DataError("invalid_number", "缺少或无效的数值字段")
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise DataError("invalid_number", "数值字段无法解析")
    if not math.isfinite(number):
        raise DataError("invalid_number", "数值不是有限数")
    return number


def valid_interval(value):
    try:
        hours = finite_number(value)
        return hours if 0 < hours <= 24 else None
    except DataError:
        return None


def annualize(rate, hours):
    """Decimal per-period rate -> simple annualized percent; no assumed interval."""
    rate = finite_number(rate)
    hours = valid_interval(hours)
    return rate * (24 / hours) * 365 * 100 if hours is not None else None


def get_json(url, params=None):
    full_url = url + ("?" + urlencode(params) if params else "")
    for attempt in range(2):
        try:
            req = Request(full_url, headers={"Accept": "application/json", "User-Agent": "DerivativesMonitor/0.2"})
            with urlopen(req, timeout=8) as response:
                body = response.read(2_000_001)
            if len(body) > 2_000_000:
                raise DataError("response_too_large", "响应超过 2 MB 上限")
            try:
                return json.loads(body)
            except (ValueError, UnicodeDecodeError):
                raise DataError("invalid_json", "接口未返回有效 JSON")
        except HTTPError as exc:
            if (exc.code == 429 or 500 <= exc.code < 600) and attempt == 0:
                time.sleep(1)
                continue
            raise DataError("http_" + str(exc.code), "公共接口返回 HTTP " + str(exc.code))
        except (URLError, TimeoutError, socket.timeout) as exc:
            if attempt == 0:
                time.sleep(1)
                continue
            reason = "请求超时" if isinstance(exc, (TimeoutError, socket.timeout)) else "网络连接失败"
            raise DataError("network_error", reason)


def payload_list(response, venue):
    if not isinstance(response, dict):
        raise DataError("invalid_response", "响应顶层必须为对象")
    if venue == "bybit":
        if response.get("retCode") != 0:
            raise DataError("api_error", "Bybit 业务错误 " + str(response.get("retCode")))
        result = response.get("result")
        result = result.get("list") if isinstance(result, dict) else None
    else:
        expected = "0" if venue == "okx" else "00000"
        if response.get("code") != expected:
            raise DataError("api_error", venue + " 业务错误 " + str(response.get("code")))
        result = response.get("data")
    if not isinstance(result, list):
        raise DataError("invalid_response", "响应缺少记录列表")
    return result


def select_record(records, key, symbol):
    matched = [r for r in records if isinstance(r, dict) and r.get(key) == symbol]
    if len(matched) != 1:
        raise DataError("missing_contract", "未返回唯一的目标合约 " + symbol)
    return matched[0]


def normalize(venue, base, response, metadata=None, fetched_at=None):
    fetched_at = fetched_at or utc_now()
    symbol = base + "-USDT-SWAP" if venue == "okx" else base + "USDT"
    interval_source = "unknown"
    interval = None
    if venue == "binance":
        if not isinstance(response, dict) or response.get("symbol") != symbol:
            raise DataError("missing_contract", "Binance 响应不匹配目标合约")
        source = response
        raw = source.get("lastFundingRate")
        source_time = timestamp_ms(source.get("time"))
        funding_time = timestamp_ms(source.get("nextFundingTime"))
        rate_field = "lastFundingRate"
        rate_kind = "published_current"
        if isinstance(metadata, list):
            matches = [m for m in metadata if isinstance(m, dict) and m.get("symbol") == symbol]
            if len(matches) == 1:
                interval = valid_interval(matches[0].get("fundingIntervalHours"))
                interval_source = "fundingInfo.fundingIntervalHours" if interval else "unknown"
        # fundingInfo is an adjustments list. Absence is NOT evidence of an 8h interval.
    elif venue == "bybit":
        source = select_record(payload_list(response, venue), "symbol", symbol)
        raw = source.get("fundingRate")
        source_time = timestamp_ms(response.get("time"))
        funding_time = timestamp_ms(source.get("nextFundingTime"))
        rate_field, rate_kind = "fundingRate", "published_current"
        interval = valid_interval(source.get("fundingIntervalHour"))
        if interval:
            interval_source = "ticker.fundingIntervalHour"
        elif metadata is not None:
            spec = select_record(payload_list(metadata, venue), "symbol", symbol)
            if spec.get("contractType") != "LinearPerpetual" or spec.get("settleCoin") != "USDT":
                raise DataError("wrong_contract", "合约不是 USDT 结算线性永续")
            try:
                interval = valid_interval(finite_number(spec.get("fundingInterval")) / 60)
            except DataError:
                interval = None
            interval_source = "instruments.fundingInterval_minutes" if interval else "unknown"
    elif venue == "okx":
        source = select_record(payload_list(response, venue), "instId", symbol)
        raw = source.get("fundingRate")
        source_time = timestamp_ms(source.get("ts"))
        funding_time = timestamp_ms(source.get("fundingTime"))
        rate_field, rate_kind = "fundingRate", "estimated_upcoming"
        next_time = timestamp_ms(source.get("nextFundingTime"))
        if funding_time and next_time:
            interval = valid_interval((parse_time(next_time) - parse_time(funding_time)).total_seconds() / 3600)
            interval_source = "nextFundingTime_minus_fundingTime" if interval else "unknown"
    elif venue == "bitget":
        source = select_record(payload_list(response, venue), "symbol", symbol)
        raw = source.get("fundingRate")
        source_time = timestamp_ms(response.get("requestTime"))
        funding_time = timestamp_ms(source.get("nextUpdate"))
        rate_field, rate_kind = "fundingRate", "published_current"
        interval = valid_interval(source.get("fundingRateInterval"))
        interval_source = "fundingRateInterval_hours" if interval else "unknown"
    else:
        raise DataError("unknown_venue", "未知交易所")
    rate = finite_number(raw)
    warnings = []
    if interval is None:
        warnings.append("interval_unknown")
    if source_time is None:
        warnings.append("source_time_missing")
    else:
        age = (parse_time(fetched_at) - parse_time(source_time)).total_seconds()
        if age > MAX_SOURCE_AGE_SECONDS:
            warnings.append("source_stale")
        elif age < -300:
            warnings.append("source_time_in_future")
    if funding_time is None:
        warnings.append("funding_time_missing")
    elif parse_time(funding_time) <= parse_time(fetched_at):
        warnings.append("funding_time_elapsed")
    return {
        "venue": venue, "base": base, "symbol": symbol, "quote": "USDT", "settle": "USDT",
        "contract_type": "linear_perpetual", "raw_rate": str(raw), "rate_decimal": rate,
        "rate_percent": rate * 100, "interval_hours": interval, "interval_source": interval_source,
        "annualized_percent": annualize(rate, interval), "rate_kind": rate_kind,
        "source_rate_field": rate_field, "source_time": source_time, "fetched_at": fetched_at,
        "funding_time": funding_time, "funding_time_label": "next_update" if venue == "bitget" else "settlement",
        "warnings": warnings, "source_endpoint": ENDPOINTS[venue],
        "raw_response": response, "raw_interval_metadata": metadata,
    }


def fetch_contract(venue, base, getter=get_json):
    symbol = base + "-USDT-SWAP" if venue == "okx" else base + "USDT"
    params = {"symbol": symbol}
    if venue == "bybit":
        params["category"] = "linear"
    elif venue == "bitget":
        params["category"] = "USDT-FUTURES"
    elif venue == "okx":
        params = {"instId": symbol}
    response = getter(ENDPOINTS[venue], params)
    metadata, metadata_error = None, None
    try:
        if venue == "binance":
            metadata = getter("https://fapi.binance.com/fapi/v1/fundingInfo")
        elif venue == "bybit":
            ticker = select_record(payload_list(response, venue), "symbol", symbol)
            if valid_interval(ticker.get("fundingIntervalHour")) is None:
                metadata = getter("https://api.bybit.com/v5/market/instruments-info", params)
    except DataError as exc:
        metadata_error = exc.code
    row = normalize(venue, base, response, metadata)
    if metadata_error:
        row["warnings"].append("interval_request_failed")
        row["interval_error"] = metadata_error
    return row


def collect(getter=get_json):
    started = utc_now()
    rows, statuses = [], {}
    for venue in VENUES:
        errors, venue_rows = [], []
        for index, base in enumerate(BASES):
            try:
                row = fetch_contract(venue, base, getter)
                venue_rows.append(row)
            except DataError as exc:
                errors.append({"base": base, "code": exc.code, "message": str(exc)})
                if exc.code in ("http_403", "http_451"):
                    for skipped in BASES[index + 1:]:
                        errors.append({"base": skipped, "code": exc.code, "message": "同一交易所访问受限，跳过重复请求"})
                    break
            except (KeyError, TypeError, ValueError) as exc:
                errors.append({"base": base, "code": "invalid_response", "message": "响应字段结构不符合预期"})
        state = "failed" if not venue_rows else "partial" if errors else "ok"
        if state == "ok" and any(r["warnings"] for r in venue_rows):
            state = "warning"
        statuses[venue] = {"status": state, "expected": len(BASES), "received": len(venue_rows), "errors": errors}
        rows.extend(venue_rows)
    return {"schema_version": 2, "run_started_at": started, "captured_at": utc_now(),
            "max_source_age_seconds": MAX_SOURCE_AGE_SECONDS,
            "scope": {"bases": list(BASES), "quote": "USDT", "contract_type": "linear_perpetual"},
            "rate_unit": "decimal_per_period", "annualized_unit": "percent_per_year_simple",
            "venues": statuses, "records": rows}


def validate_snapshot(snapshot):
    if snapshot.get("schema_version") != 2:
        raise ValueError("不支持的数据版本")
    keys = set()
    for row in snapshot["records"]:
        key = (row["venue"], row["symbol"])
        if key in keys:
            raise ValueError("重复合约")
        keys.add(key)
        rate = finite_number(row["rate_decimal"])
        expected = annualize(rate, row["interval_hours"])
        actual = row["annualized_percent"]
        if expected is None:
            if actual is not None:
                raise ValueError("未知周期不得计算年化")
        elif actual is None or not math.isclose(expected, finite_number(actual), rel_tol=1e-10, abs_tol=1e-10):
            raise ValueError("年化计算不一致")
        if not math.isclose(rate * 100, finite_number(row["rate_percent"]), rel_tol=1e-10, abs_tol=1e-10):
            raise ValueError("周期费率百分数不一致")
    for venue in VENUES:
        actual_count = sum(r["venue"] == venue for r in snapshot["records"])
        if snapshot["venues"][venue]["received"] != actual_count:
            raise ValueError("交易所记录数量不一致")
    json.dumps(snapshot, allow_nan=False)


def atomic_text(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=".pending-", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(content)
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def serialize(value):
    return json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n"


def save_run(snapshot, root=ROOT):
    """Never replace the last data snapshot with an all-failed run."""
    root = Path(root)
    validate_snapshot(snapshot)
    data_dir = root / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    run_id = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H%M%S.%fZ")
    # Exclusive creation prevents accidental overwrites even within the same minute.
    attempts = data_dir / "attempts"
    attempts.mkdir(exist_ok=True)
    with (attempts / (run_id + ".json")).open("x", encoding="utf-8") as handle:
        handle.write(serialize(snapshot))
    latest_path = data_dir / "latest.json"
    if snapshot["records"]:
        history = data_dir / "history"
        history.mkdir(exist_ok=True)
        with (history / (run_id + ".json")).open("x", encoding="utf-8") as handle:
            handle.write(serialize(snapshot))
        atomic_text(latest_path, serialize(snapshot))
        latest = snapshot
    else:
        latest = json.loads(latest_path.read_text(encoding="utf-8")) if latest_path.exists() else None
    atomic_text(data_dir / "last-attempt.json", serialize(snapshot))
    # A single browser bundle prevents mismatched snapshot/status reads and works via file://.
    bundle = {"snapshot": latest, "last_attempt": snapshot}
    encoded = serialize(bundle).replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    atomic_text(root / "funding-data.js", "// Generated by collect_funding.py; public market data only.\nwindow.FUNDING_DATA = " + encoded.rstrip() + ";\n")
    return bool(snapshot["records"])


def main():
    parser = argparse.ArgumentParser(description="按需采集 BTC/ETH 公开资金费率，运行结束即退出")
    parser.add_argument("--output-dir", type=Path, default=ROOT)
    args = parser.parse_args()
    snapshot = collect()
    available = save_run(snapshot, args.output_dir)
    for venue, state in snapshot["venues"].items():
        codes = ", ".join(sorted({e["code"] for e in state["errors"]}))
        print(f"{venue}: {state['status']} ({state['received']}/{state['expected']}) {codes}")
    print("已保存公开数据快照。" if available else "全部采集失败；保留上次数据，仅更新本次状态。")
    return 0 if available else 1


if __name__ == "__main__":
    raise SystemExit(main())
