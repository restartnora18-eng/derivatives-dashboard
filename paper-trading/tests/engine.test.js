import test from "node:test";
import assert from "node:assert/strict";
import { Engine, decimal, fixed } from "../src/engine.js";
let serial = 0;
function quote(price, time = ++serial * 1000) {
  return {
    source: "demo",
    eventTime: time,
    receivedAt: time,
    bid: String(price),
    ask: String(price),
    mark: String(price),
  };
}
function trade(e, action, q, p) {
  const z = quote(p);
  return e.execute(
    {
      id: `t-${++serial}`,
      action,
      quantity: String(q),
      submittedAt: z.receivedAt,
    },
    z,
  );
}
const make = (c) => new Engine({ fee: "0", slippage: "0", ...c });
test("long profit and short profit are symmetric", () => {
  for (const [action, p] of [
    ["long", 110],
    ["short", 90],
  ]) {
    const e = make();
    trade(e, action, 2, 100);
    trade(e, "close", 2, p);
    assert.equal(fixed(e.state.balance), fixed("10020"));
    assert.equal(e.state.cycles.length, 1);
  }
});
test("weighted entry, partial closing preserves average", () => {
  const e = make();
  trade(e, "long", 1, 100);
  trade(e, "long", 1, 120);
  assert.equal(fixed(e.state.average), fixed("110"));
  trade(e, "reduce", 0.5, 130);
  assert.equal(fixed(e.state.qty), fixed("1.5"));
  assert.equal(fixed(e.state.average), fixed("110"));
  assert.equal(fixed(e.state.balance), fixed("10010"));
  assert.equal(e.state.cycles.length, 0);
});
test("fees and funding included once in completed cycle", () => {
  const e = make({ fee: "0.001" });
  trade(e, "long", 1, 100);
  const t = ++serial * 1000;
  e.funding("f", t, "0.01", "100");
  e.funding("f", t, "0.01", "100");
  trade(e, "close", 1, 110);
  assert.equal(fixed(e.state.balance), fixed("10008.79"));
  assert.equal(fixed(e.state.cycles[0].net), fixed("8.79"));
});
test("negative funding credits long and positive credits short", () => {
  for (const [action, rate] of [
    ["long", "-0.01"],
    ["short", "0.01"],
  ]) {
    const e = make();
    trade(e, action, 1, 100);
    e.funding("f", ++serial * 1000, rate, "100");
    assert.equal(fixed(e.state.balance), fixed("10001"));
  }
});
test("insufficient margin rolls back all state", () => {
  const e = make({ initial: "100", leverage: "1" }),
    before = e.export();
  assert.throws(() => trade(e, "long", 2, 100), /margin/i);
  assert.deepEqual(e.export(), before);
});
test("duplicate orders are idempotent", () => {
  const e = make(),
    z = quote(100),
    i = {
      id: "same",
      action: "long",
      quantity: "1",
      submittedAt: z.receivedAt,
    };
  e.execute(i, z);
  e.execute(i, z);
  assert.equal(e.state.events.length, 1);
});
test("reject stale and future quotes, reverse and overclose", () => {
  const e = make(),
    z = quote(100);
  assert.throws(() =>
    e.execute(
      { id: "a", action: "long", quantity: "1", submittedAt: z.receivedAt + 1 },
      z,
    ),
  );
  assert.throws(() => e.tick({ ...z, eventTime: z.receivedAt + 1 }));
  trade(e, "long", 1, 100);
  assert.throws(() => trade(e, "short", 1, 100));
  assert.throws(() => trade(e, "reduce", 2, 100));
  assert.equal(fixed(e.state.qty), fixed("1"));
});
test("liquidation closes position with extra fee and records cycle", () => {
  const e = make({ initial: "100", leverage: "10" });
  trade(e, "long", 10, 100);
  const fill = e.tick(quote(90));
  assert.ok(fill);
  assert.equal(e.state.direction, 0);
  assert.equal(e.state.events.at(-1).type, "liquidation");
  assert.equal(fixed(e.state.balance), fixed("-0.9"));
  assert.equal(fixed(e.state.cycles[0].net), fixed("-100.9"));
});
test("margin and equity identity, restore exact state", () => {
  const e = make();
  trade(e, "long", 2, 100);
  const v = e.values("110");
  assert.equal(v.margin, fixed("40"));
  assert.equal(v.equity, v.balance + v.unrealized);
  const snap = JSON.parse(JSON.stringify(e.export())),
    r = new Engine(snap.config, snap.state);
  assert.deepEqual(r.export(), e.export());
  assert.deepEqual(r.values("110"), v);
});
test("slippage unfavorable for both sides", () => {
  for (const [action, price] of [
    ["long", "101"],
    ["short", "99"],
  ]) {
    const e = make({ slippage: "0.01" });
    assert.equal(fixed(trade(e, action, 1, 100).price), fixed(price));
  }
});
test("fixed amounts reject excessive precision and roundtrip negative", () => {
  assert.throws(() => fixed("0.000000001"));
  assert.equal(decimal(fixed("-1.23456789")), "-1.23456789");
});

test("invalid or inverted quote is rejected without mutation", () => {
  const e = make();
  const before = e.export();
  assert.throws(() => e.tick({ ...quote(100), receivedAt: NaN }));
  assert.throws(() => e.tick({ ...quote(100), bid: "102", ask: "100" }));
  assert.deepEqual(e.export(), before);
});
