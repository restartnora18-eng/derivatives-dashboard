"""Explicit native/CCXT/compare runner. Never writes existing dashboard data."""
import argparse
import json
import math
from pathlib import Path

from .readonly import AdapterError, OPERATIONS, ReadOnlyAdapter, load_config


def compare(left, right):
    if 'error' in left or 'error' in right or left.get('status') == 'failed' or right.get('status') == 'failed':
        return {'comparable': False, 'reason': 'A provider failed; no automatic fallback.'}
    if any(left.get(k) != right.get(k) for k in ('exchange', 'symbol', 'operation')):
        return {'comparable': False, 'reason': 'Different markets or operations cannot be compared.'}
    trade = left['operation'] == 'trades'
    key = (lambda r: r['id']) if trade else (lambda r: r['timestamp'])
    a, b = ({key(r): r for r in rows['records']} for rows in (left, right))
    differences = []
    for identity in a.keys() & b.keys():
        for field in a[identity].keys() & b[identity].keys():
            x, y = a[identity][field], b[identity][field]
            equal = math.isclose(x, y, rel_tol=1e-8, abs_tol=1e-10) if isinstance(x, (int, float)) and isinstance(y, (int, float)) else x == y
            if not equal:
                differences.append({'record': identity, 'field': field, 'native': x, 'ccxt': y})
    common = len(a.keys() & b.keys())
    return {'comparable': bool(common), 'shared_records': common,
            'native_only': len(a.keys() - b.keys()), 'ccxt_only': len(b.keys() - a.keys()),
            'differences': differences, 'note': 'Only matching timestamps/trade IDs are compared; requests are not simultaneous.'}


def run(settings, operation, provider=None):
    chosen = provider or settings.get('provider', 'native')
    config = {k: v for k, v in settings.items() if k != 'provider'}
    results = {}
    for name in ('native', 'ccxt') if chosen == 'compare' else (chosen,):
        try:
            results[name] = ReadOnlyAdapter(provider=name, **config).read(operation)
        except AdapterError as exc:
            results[name] = {'provider': name, 'status': 'failed', 'error': {'code': exc.code, 'message': str(exc)}, 'fallback_used': False}
    if chosen != 'compare':
        return results[chosen]
    return {'mode': 'compare', 'results': results, 'comparison': compare(results['native'], results['ccxt'])}


def main(argv=None):
    p = argparse.ArgumentParser(description='独立只读数据适配验证；不替换现有采集器')
    p.add_argument('--config', type=Path, default=Path(__file__).resolve().parents[1] / 'market-source.json')
    p.add_argument('--provider', choices=('native', 'ccxt', 'compare'), help='本次选择；不改写默认配置')
    p.add_argument('--operation', choices=OPERATIONS, default='long_short_ratio')
    p.add_argument('--out', type=Path, help='可选：导出本次结果，不指定则只打印')
    args = p.parse_args(argv)
    try:
        result = run(load_config(args.config), args.operation, args.provider)
    except AdapterError as exc:
        result = {'status': 'failed', 'error': {'code': exc.code, 'message': str(exc)}}
    text = json.dumps(result, ensure_ascii=False, allow_nan=False, indent=2)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(text + '\n', encoding='utf-8')
    print(text)
    states = result.get('results', {'single': result}).values()
    return int(any(r.get('status') == 'failed' for r in states))


if __name__ == '__main__':
    raise SystemExit(main())
