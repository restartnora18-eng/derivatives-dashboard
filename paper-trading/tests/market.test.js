// Synthetic fixtures for unit testing only; no fixture is available to the application.
import test from "node:test";
import assert from "node:assert/strict";
import {
  BinanceMarket,
  HOUR,
  BINANCE_BASE,
  parseCandles,
  parseQuote,
} from "../src/market.js";
const now = 1700000000000;
const book = {
  symbol: "BTCUSDT",
  bidPrice: "68000.00",
  askPrice: "68000.10",
  time: now,
};
const mark = { symbol: "BTCUSDT", markPrice: "68000.05", time: now };
const rows = [
  [
    Math.floor(now / HOUR) * HOUR,
    "67000.00",
    "69000.00",
    "66000.00",
    "68000.00",
  ],
];
function provider({ fail = false } = {}) {
  const urls = [];
  const schedules = [];
  const cancelled = [];
  const market = new BinanceMarket({
    now: () => now,
    fetchImpl: async (url, options) => {
      urls.push(url);
      assert.equal(options.credentials, "omit");
      assert.equal(options.cache, "no-store");
      if (fail) return { ok: false, status: 451 };
      const body = url.includes("/time")
        ? { serverTime: now }
        : url.includes("bookTicker")
          ? book
          : url.includes("premiumIndex")
            ? mark
            : rows;
      return { ok: true, json: async () => structuredClone(body) };
    },
    schedule: (cb, delay) => {
      schedules.push({ cb, delay });
      return schedules.length;
    },
    cancel: (id) => cancelled.push(id),
  });
  return { market, urls, schedules, cancelled };
}
test("only official Binance endpoints; actual returned OHLC and quotes preserved", async () => {
  const { market, urls } = provider();
  const q = await market.refresh();
  assert.equal(urls.length, 4);
  assert.ok(urls.every((u) => u.startsWith(BINANCE_BASE + "/fapi/")));
  assert.ok(urls.some((u) => u.includes("interval=1h&limit=500")));
  assert.equal(q.bid, book.bidPrice);
  assert.equal(q.mark, mark.markPrice);
  assert.equal(q.exchangeTime, now);
  assert.equal(q.venue, "binance");
  assert.equal(q.source, "public");
  assert.equal(q.requestStartedAt, now);
  assert.deepEqual(q.provenance.book, book);
  assert.deepEqual(q.provenance.klines, rows);
  assert.deepEqual(q.candles[0], {
    time: rows[0][0] / 1000,
    open: 67000,
    high: 69000,
    low: 66000,
    close: 68000,
  });
});
test("initial load immediate, subsequent schedule exactly one hour", async () => {
  const { market, schedules, cancelled } = provider();
  let count = 0;
  await market.start(
    () => count++,
    () => {},
  );
  assert.equal(count, 1);
  assert.equal(schedules[0].delay, HOUR);
  assert.equal(market.nextUpdate, now + HOUR);
  await schedules[0].cb();
  assert.equal(count, 2);
  assert.equal(schedules[1].delay, HOUR);
  market.stop();
  assert.equal(cancelled[0], 2);
});
test("HTTP 451 emits error, no fabricated quote or fallback; hourly retry", async () => {
  const { market, urls, schedules } = provider({ fail: true });
  let quotes = 0,
    errors = 0;
  await market.start(
    () => quotes++,
    (e) => {
      errors++;
      assert.match(e.message, /451/);
    },
  );
  assert.equal(quotes, 0);
  assert.equal(errors, 1);
  assert.equal(urls.length, 1);
  assert.equal(schedules[0].delay, HOUR);
  await assert.rejects(market.refresh(), /451/);
  assert.equal(quotes, 0);
});
test("reject stale, wrong symbol, future, inverted prices and invalid bars", () => {
  assert.throws(() => parseQuote({ ...book, time: now - 5001 }, mark, now, 0));
  assert.throws(() => parseQuote({ ...book, symbol: "ETHUSDT" }, mark, now, 0));
  assert.throws(() => parseQuote({ ...book, time: now + 501 }, mark, now, 0));
  assert.throws(() => parseQuote({ ...book, bidPrice: "70000" }, mark, now, 0));
  assert.throws(() => parseCandles([...rows, ...rows], now));
  assert.throws(() =>
    parseCandles([[rows[0][0], "67000", "65000", "66000", "68000"]], now),
  );
});
test("clock offset normalized without losing exchange timestamp", () => {
  const q = parseQuote(book, mark, now - 10000, 10000);
  assert.equal(q.exchangeTime, now);
  assert.equal(q.eventTime, now - 10000);
  assert.equal(q.clockOffset, 10000);
});
test("fresh order cannot reuse earlier in-flight snapshot", async () => {
  const { market, urls } = provider();
  const first = market.refresh();
  const second = market.refresh({ fresh: true });
  await Promise.all([first, second]);
  assert.equal(urls.length, 8);
});
