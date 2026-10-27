// Amounts are stored as decimal strings in snapshots; arithmetic uses fixed 8 decimals.
const SCALE = 100000000n;
export const fixed = (v) => {
  const s = String(v);
  if (!/^-?\d+(\.\d{1,8})?$/.test(s)) throw Error("Values support up to 8 decimal places");
  const neg = s.startsWith("-");
  const [a, b = ""] = s.replace("-", "").split(".");
  return (BigInt(a) * SCALE + BigInt(b.padEnd(8, "0"))) * (neg ? -1n : 1n);
};
export const decimal = (v) =>
  `${v < 0n ? "-" : ""}${(v < 0n ? -v : v) / SCALE}.${((v < 0n ? -v : v) % SCALE).toString().padStart(8, "0")}`;
const mul = (a, b) => (a * b) / SCALE,
  div = (a, b) => (a * SCALE) / b;
const defaults = {
  initial: "10000",
  leverage: "5",
  fee: "0.0005",
  slippage: "0.0002",
  maintenance: "0.005",
  liquidationFee: "0.001",
  fundingMode: "off",
  fundingRate: "0.0001",
  fundingInterval: 28800000,
};
function validateQuote(quote) {
  if (
    !["demo", "public"].includes(quote.source) ||
    !Number.isSafeInteger(quote.eventTime) ||
    !Number.isSafeInteger(quote.receivedAt) ||
    quote.eventTime <= 0 ||
    quote.eventTime > quote.receivedAt ||
    quote.receivedAt - quote.eventTime > 5000
  )
    throw Error("Invalid quote source or timestamp");
  const bid = fixed(quote.bid),
    ask = fixed(quote.ask),
    mark = fixed(quote.mark);
  if (bid <= 0n || ask < bid || mark <= 0n) throw Error("Invalid quote price");
}
export class Engine {
  constructor(config = {}, snapshot) {
    this.config = { ...defaults, ...config };
    for (const k of [
      "initial",
      "leverage",
      "fee",
      "slippage",
      "maintenance",
      "liquidationFee",
      "fundingRate",
    ])
      fixed(this.config[k]);
    if (
      fixed(this.config.initial) <= 0n ||
      fixed(this.config.leverage) < SCALE ||
      fixed(this.config.leverage) > 100n * SCALE
    )
      throw Error("Invalid initial balance or leverage");
    for (const k of ["fee", "slippage", "maintenance", "liquidationFee"])
      if (fixed(this.config[k]) < 0n || fixed(this.config[k]) >= SCALE)
        throw Error("Invalid fee rate");
    if (
      !["off", "fixed"].includes(this.config.fundingMode) ||
      !Number.isSafeInteger(this.config.fundingInterval) ||
      this.config.fundingInterval < 60000
    )
      throw Error("Invalid funding rules");
    this.state = snapshot
      ? structuredClone(snapshot)
      : {
          balance: this.config.initial,
          qty: "0",
          average: "0",
          direction: 0,
          events: [],
          equity: [],
          seen: [],
          cycleNet: "0",
          cycles: [],
          lastTime: 0,
          version: 1,
        };
  }
  values(mark) {
    const s = this.state,
      p = fixed(mark),
      q = fixed(s.qty),
      balance = fixed(s.balance),
      unrealized = mul(q, p - fixed(s.average)) * BigInt(s.direction),
      margin = div(mul(q, fixed(s.average)), fixed(this.config.leverage));
    return {
      balance,
      unrealized,
      equity: balance + unrealized,
      margin,
      available: balance + unrealized - margin,
      maintenance: mul(mul(q, p), fixed(this.config.maintenance)),
    };
  }
  transact(fn) {
    const old = structuredClone(this.state);
    try {
      return fn();
    } catch (e) {
      this.state = old;
      throw e;
    }
  }
  execute(intent, quote) {
    validateQuote(quote);
    return this.transact(() => {
      const s = this.state;
      if (s.seen.includes(intent.id)) return null;
      if (
        !intent.id ||
        !["long", "short", "reduce", "close"].includes(intent.action)
      )
        throw Error("Invalid order intent");
      if (quote.source !== "demo" && quote.source !== "public")
        throw Error("Unknown quote source");
      if (
        !Number.isFinite(intent.submittedAt) ||
        quote.receivedAt < intent.submittedAt ||
        quote.eventTime > quote.receivedAt ||
        quote.receivedAt - quote.eventTime > 5000 ||
        quote.receivedAt < s.lastTime
      )
        throw Error("Stale quote or invalid event order");
      let q = fixed(intent.quantity),
        old = fixed(s.qty),
        closing = ["reduce", "close"].includes(intent.action);
      if (intent.action === "close") q = old;
      if (q <= 0n || q % 1000n !== 0n)
        throw Error("Quantity must be positive in steps of 0.00001 BTC");
      let direction = closing ? s.direction : intent.action === "long" ? 1 : -1;
      if (!direction || (closing && q > old)) throw Error("Reduction exceeds position size");
      if (!closing && s.direction && s.direction !== direction)
        throw Error("Close the position before reversing direction");
      const buy = closing ? direction < 0 : direction > 0;
      const bid = fixed(quote.bid),
        ask = fixed(quote.ask),
        mark = fixed(quote.mark);
      if (bid <= 0n || ask < bid || mark <= 0n) throw Error("Invalid quote price");
      const price = mul(
        buy ? ask : bid,
        SCALE + (buy ? 1n : -1n) * fixed(this.config.slippage),
      );
      const fee = mul(mul(q, price), fixed(this.config.fee));
      let pnl = 0n;
      if (closing) {
        pnl = mul(q, price - fixed(s.average)) * BigInt(direction);
        s.qty = decimal(old - q);
      } else {
        s.average = decimal(
          div(mul(old, fixed(s.average)) + mul(q, price), old + q),
        );
        s.qty = decimal(old + q);
        s.direction = direction;
      }
      s.balance = decimal(fixed(s.balance) + pnl - fee);
      s.cycleNet = decimal(fixed(s.cycleNet) + pnl - fee);
      if (!closing) {
        const v = this.values(quote.mark);
        if (v.available < 0n || v.equity <= v.maintenance)
          throw Error("Insufficient available margin");
      }
      const event = {
        id: intent.id,
        type: "fill",
        action: intent.action,
        time: quote.eventTime,
        receivedAt: quote.receivedAt,
        price: decimal(price),
        quantity: decimal(q),
        direction,
        pnl: decimal(pnl),
        fee: decimal(fee),
        source: quote.source,
        venue: quote.venue || "local-demo",
        exchangeTime: quote.exchangeTime ?? null,
        referenceBid: quote.bid,
        referenceAsk: quote.ask,
        referenceMark: quote.mark,
        marketTime: {
          book: quote.bookTime ?? null,
          mark: quote.markTime ?? null,
        },
      };
      s.events.push(event);
      s.seen.push(intent.id);
      s.lastTime = quote.receivedAt;
      if (fixed(s.qty) === 0n) {
        s.cycles.push({ time: quote.eventTime, net: s.cycleNet });
        s.cycleNet = "0";
        s.average = "0";
        s.direction = 0;
      }
      this.record(quote);
      return event;
    });
  }
  funding(id, time, rate, mark) {
    return this.transact(() => {
      const s = this.state;
      if (s.seen.includes(id)) return;
      if (time < s.lastTime) throw Error("Cannot backfill past funding");
      const cash =
        -mul(mul(fixed(s.qty), fixed(mark)), fixed(rate)) * BigInt(s.direction);
      s.balance = decimal(fixed(s.balance) + cash);
      s.cycleNet = decimal(fixed(s.cycleNet) + cash);
      s.events.push({
        id,
        type: "funding",
        time,
        cash: decimal(cash),
        rate: String(rate),
      });
      s.seen.push(id);
      s.lastTime = time;
    });
  }
  tick(quote) {
    validateQuote(quote);
    return this.transact(() => {
      if (
        quote.eventTime > quote.receivedAt ||
        quote.receivedAt - quote.eventTime > 5000 ||
        quote.receivedAt < this.state.lastTime
      )
        throw Error("Invalid quote event order");
      const v = this.values(quote.mark);
      let event;
      if (
        fixed(this.state.qty) > 0n &&
        v.equity <=
          v.maintenance +
            mul(
              mul(fixed(this.state.qty), fixed(quote.mark)),
              fixed(this.config.liquidationFee),
            )
      ) {
        event = this.execute(
          {
            id: `liq-${quote.receivedAt}`,
            action: "close",
            quantity: this.state.qty,
            submittedAt: quote.receivedAt,
          },
          quote,
        );
        const fee = mul(
          mul(fixed(event.quantity), fixed(event.price)),
          fixed(this.config.liquidationFee),
        );
        this.state.balance = decimal(fixed(this.state.balance) - fee);
        this.state.cycles.at(-1).net = decimal(
          fixed(this.state.cycles.at(-1).net) - fee,
        );
        this.state.events.push({
          id: `${event.id}-fee`,
          type: "liquidation",
          time: quote.eventTime,
          fee: decimal(fee),
          source: quote.source,
        });
      }
      this.state.lastTime = quote.receivedAt;
      this.record(quote, false);
      return event;
    });
  }
  record(quote, force = true) {
    if (
      !force &&
      this.state.equity.at(-1) &&
      quote.eventTime - this.state.equity.at(-1).time < 10000
    )
      return;
    const v = this.values(quote.mark),
      point = {
        time: quote.eventTime,
        equity: decimal(v.equity),
        source: quote.source,
        venue: quote.venue || "local-demo",
        exchangeTime: quote.exchangeTime ?? null,
        referenceBid: quote.bid,
        referenceAsk: quote.ask,
        referenceMark: quote.mark,
        marketTime: {
          book: quote.bookTime ?? null,
          mark: quote.markTime ?? null,
        },
      };
    if (this.state.equity.at(-1)?.time === point.time)
      this.state.equity[this.state.equity.length - 1] = point;
    else this.state.equity.push(point);
  }
  export() {
    return {
      schemaVersion: 1,
      config: this.config,
      state: structuredClone(this.state),
    };
  }
}
