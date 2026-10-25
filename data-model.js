(function (root) {
  'use strict';
  const venueNames = ['binance', 'bybit', 'okx', 'bitget'];
  const warningLabels = {
    interval_unknown: '周期未核验', source_time_missing: '来源时间缺失',
    source_stale: '来源数据已过期', source_time_in_future: '来源时间异常',
    funding_time_missing: '结算/更新时间缺失', funding_time_elapsed: '已越过结算/更新时间',
    interval_request_failed: '周期接口请求失败',
  };
  function quality(row, now = Date.now(), maxAgeSeconds = 1800) {
    const warnings = new Set(row.warnings || []);
    const sourceTime = Date.parse(row.source_time);
    if (!Number.isFinite(sourceTime)) warnings.add('source_time_missing');
    else if (now - sourceTime > maxAgeSeconds * 1000) warnings.add('source_stale');
    else if (sourceTime - now > 5 * 60 * 1000) warnings.add('source_time_in_future');
    const fundingTime = Date.parse(row.funding_time);
    if (!Number.isFinite(fundingTime)) warnings.add('funding_time_missing');
    else if (fundingTime <= now) warnings.add('funding_time_elapsed');
    if (!(row.interval_hours > 0)) warnings.add('interval_unknown');
    return [...warnings];
  }
  function live(bundle, now = Date.now()) {
    const snapshot = bundle?.snapshot;
    const attempt = bundle?.last_attempt;
    const maxAgeSeconds = Number.isFinite(snapshot?.max_source_age_seconds) && snapshot.max_source_age_seconds > 0 ? snapshot.max_source_age_seconds : 1800;
    return {
      mode: 'collected', captured: snapshot?.captured_at || null,
      attempted: attempt?.captured_at || null, statuses: attempt?.venues || {},
      max_source_age_seconds: maxAgeSeconds,
      retained: !!snapshot && !!attempt && snapshot.captured_at !== attempt.captured_at,
      rows: (snapshot?.records || []).map(row => {
        const warnings = quality(row, now, maxAgeSeconds);
        return {...row, symbol: row.base, contract: row.symbol, rate: row.annualized_percent,
          warnings, eligible: warnings.length === 0 && Number.isFinite(row.annualized_percent)};
      }),
    };
  }
  function legacy(snapshot) {
    const rows = Object.entries(snapshot.venues).flatMap(([venue, rates]) =>
      Object.entries(rates).filter(([, rate]) => Number.isFinite(rate)).map(([symbol, rate]) =>
        ({venue, symbol, contract: '原快照未保存', rate, rate_percent: null,
          interval_hours: null, eligible: true, warnings: ['interval_unknown'], rate_kind: 'legacy'})));
    return {mode: 'legacy', captured: snapshot.captured_utc.replace(' UTC', 'Z').replace(' ', 'T'),
      statuses: Object.fromEntries(venueNames.map(venue => [venue, {
        status: Object.keys(snapshot.venues[venue] || {}).length ? 'legacy' : 'missing',
        received: Object.keys(snapshot.venues[venue] || {}).length, errors: [],
      }])), rows, retained: false};
  }
  function select(rows, query = '', venue = 'all', sort = 'high') {
    query = query.trim().toUpperCase();
    return rows.filter(row => (venue === 'all' || row.venue === venue) &&
      (row.symbol.toUpperCase().includes(query) || row.contract.toUpperCase().includes(query)))
      .sort((a, b) => {
        if (sort === 'name') return a.symbol.localeCompare(b.symbol) || a.venue.localeCompare(b.venue);
        if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
        if (!Number.isFinite(a.rate) || !Number.isFinite(b.rate)) {
          return Number.isFinite(a.rate) ? -1 : Number.isFinite(b.rate) ? 1 : a.symbol.localeCompare(b.symbol);
        }
        return (sort === 'high' ? b.rate - a.rate : a.rate - b.rate) || a.venue.localeCompare(b.venue);
      });
  }
  const api = {venueNames, warningLabels, quality, live, legacy, select};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FundingModel = api;
})(typeof globalThis === 'undefined' ? this : globalThis);
