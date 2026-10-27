import { fixed } from "./engine.js";
export const HOUR = 3600000;
export const BINANCE_BASE = "https://fapi.binance.com";
const ENDPOINTS = {
  clock: "/fapi/v1/time",
  book: "/fapi/v1/ticker/bookTicker?symbol=BTCUSDT",
  mark: "/fapi/v1/premiumIndex?symbol=BTCUSDT",
  candles: "/fapi/v1/klines?symbol=BTCUSDT&interval=1h&limit=500",
};
function positive(value) {
  if (typeof value !== "string" || fixed(value) <= 0n)
    throw Error("Invalid Binance price format");
  return value;
}
export function parseCandles(rows, serverNow) {
  if (!Array.isArray(rows) || !rows.length) throw Error("No Binance candles returned");
  let previous = -1;
  return rows.map((row) => {
    if (
      !Array.isArray(row) ||
      !Number.isSafeInteger(row[0]) ||
      row[0] % HOUR !== 0 ||
      row[0] <= previous ||
      row[0] > serverNow
    )
      throw Error("Invalid Binance candle timestamp");
    previous = row[0];
    const [open, high, low, close] = row.slice(1, 5).map(positive).map(Number);
    if (
      high < Math.max(open, close) ||
      low > Math.min(open, close) ||
      low > high
    )
      throw Error("Invalid Binance OHLC data");
    return { time: row[0] / 1000, open, high, low, close };
  });
}
export function parseQuote(book, mark, receivedAt, offset) {
  if (book.symbol !== "BTCUSDT" || mark.symbol !== "BTCUSDT")
    throw Error("Binance symbol mismatch");
  const bid = positive(book.bidPrice),
    ask = positive(book.askPrice),
    price = positive(mark.markPrice);
  if (fixed(ask) < fixed(bid)) throw Error("Inverted Binance bid/ask");
  const exchangeTime = Math.min(book.time, mark.time);
  const serverNow = receivedAt + offset;
  if (
    ![book.time, mark.time].every(
      (t) =>
        Number.isSafeInteger(t) &&
        serverNow - t <= 5000 &&
        t - serverNow <= 500,
    )
  )
    throw Error("Stale Binance quote or clock mismatch; fill rejected");
  // Raw exchange timestamps remain available for audit; engine timestamps use local UTC clock.
  const eventTime = Math.min(receivedAt, Math.round(exchangeTime - offset));
  return {
    id: `binance-${book.time}-${mark.time}-${receivedAt}`,
    source: "public",
    venue: "binance",
    symbol: "BTCUSDT",
    eventTime,
    exchangeTime,
    bookTime: book.time,
    markTime: mark.time,
    receivedAt,
    clockOffset: offset,
    bid,
    ask,
    mark: price,
  };
}
export class BinanceMarket {
  constructor({
    fetchImpl = (...args) => globalThis.fetch(...args),
    now = Date.now,
    schedule = (callback, delay) => globalThis.setTimeout(callback, delay),
    cancel = (id) => globalThis.clearTimeout(id),
  } = {}) {
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.schedule = schedule;
    this.cancel = cancel;
    this.timer = null;
    this.inflight = null;
    this.stopped = true;
    this.nextUpdate = null;
  }
  async request(path) {
    const response = await this.fetchImpl(BINANCE_BASE + path, {
      cache: "no-store",
      credentials: "omit",
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw Error(
        `Binance HTTP ${response.status}${response.status === 451 ? ": unavailable from this network or region" : ""}`,
      );
    const data = await response.json();
    if (data?.code < 0) throw Error(`Binance API error ${data.code}`);
    return data;
  }
  async clock() {
    const begin = this.now(),
      raw = await this.request(ENDPOINTS.clock),
      end = this.now();
    if (!Number.isSafeInteger(raw.serverTime) || end - begin > 3000)
      throw Error("Binance clock calibration failed");
    return { offset: raw.serverTime - (begin + end) / 2, raw };
  }
  async fetchSnapshot(history) {
    const requestStartedAt = this.now();
    const { offset, raw: clock } = await this.clock();
    const [book, mark, rows] = await Promise.all([
      this.request(ENDPOINTS.book),
      this.request(ENDPOINTS.mark),
      history ? this.request(ENDPOINTS.candles) : null,
    ]);
    const receivedAt = this.now(),
      q = parseQuote(book, mark, receivedAt, offset);
    q.requestStartedAt = requestStartedAt;
    if (rows) q.candles = parseCandles(rows, receivedAt + offset);
    q.provenance = {
      baseURL: BINANCE_BASE,
      receivedAt,
      clock,
      book,
      mark,
      ...(rows ? { klines: rows } : {}),
    };
    return q;
  }
  async refresh({ history = true, fresh = false } = {}) {
    if (this.inflight) {
      if (!fresh) return this.inflight;
      await this.inflight.catch(() => {});
    }
    const task = (async () => {
      try {
        const q = await this.fetchSnapshot(history);
        await this.onQuote?.(q);
        return q;
      } catch (error) {
        this.onError?.(error);
        throw error;
      }
    })();
    this.inflight = task;
    try {
      return await task;
    } finally {
      if (this.inflight === task) this.inflight = null;
    }
  }
  async start(onQuote, onError) {
    this.onQuote = onQuote;
    this.onError = onError;
    this.stopped = false;
    const poll = async () => {
      try {
        await this.refresh();
      } catch {}
      if (!this.stopped) {
        this.nextUpdate = this.now() + HOUR;
        this.timer = this.schedule(poll, HOUR);
      }
    };
    await poll();
  }
  stop() {
    this.stopped = true;
    this.cancel(this.timer);
  }
}
export function validateSignal(signal, now) {
  if (
    !Number.isSafeInteger(signal.generatedAt) ||
    !Number.isSafeInteger(signal.availableAt) ||
    !signal.id ||
    !signal.source ||
    signal.availableAt > now ||
    signal.generatedAt > signal.availableAt
  )
    throw Error("Signal unavailable or contains future information");
  return Object.freeze({ ...signal });
}
