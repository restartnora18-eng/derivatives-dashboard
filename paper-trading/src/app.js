import { createAssetsChart } from "./assets-chart.js?v=english-1";
import { formatBeijing, chartTimeBeijing, tickBeijing } from "./time.js?v=english-1";
import { Engine, decimal } from "./engine.js?v=english-1";
import { load, save } from "./storage.js";
import { BinanceMarket, HOUR } from "./market.js?v=english-1";
const $ = (s) => document.querySelector(s),
  num = (v) => Number(v),
  money = (v) =>
    num(v).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
const names = {
  long: "Long / Add",
  short: "Short / Add",
  reduce: "Reduce",
  close: "Close",
  funding: "Funding",
  liquidation: "Paper liquidation fee",
};
let engine,
  quote,
  pending,
  chart,
  series,
  markers,
  storageFailed = false,
  candles = [],
  bucket = null,
  lastFundingBucket = null;
const market = new BinanceMarket();
const ACCOUNT_LOCK = 'kimra-paper-account-writer';
const accountChannel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('kimra-paper-account-control') : null;
let ownsAccount = false;
let accountReady = false;
let releasingAccount = false;
let releaseAccount = null;
function setTradingEnabled(enabled) {
  document.querySelectorAll('.actions button, #quantity').forEach(control => { control.disabled = !enabled; });
}
function status(s) {
  $("#status").textContent = s;
}
function download(blob, name) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function makeChart() {
  if (chart || $("#fallback")) return;
  if (!window.LightweightCharts) {
    const c = document.createElement("canvas");
    c.id = "fallback";
    c.style.width = "100%";
    c.style.height = "100%";
    $("#chart").append(c);
    status("Chart library unavailable; using local rendering for Binance data.");
    return;
  }
  chart = LightweightCharts.createChart($("#chart"), {
    autoSize: true,
    layout: { background: { color: "#0d0c13" }, textColor: "#8a9bac" },
    grid: { vertLines: { color: "#1b1a24" }, horzLines: { color: "#1b1a24" } },
    localization: { locale: 'en-US', timeFormatter: chartTimeBeijing },
    leftPriceScale: { visible: true },
    rightPriceScale: { visible: false },
    timeScale: { timeVisible: true, secondsVisible: false, tickMarkFormatter: tickBeijing },
  });
  series = chart.addSeries(LightweightCharts.CandlestickSeries, {
    priceScaleId: "left",
    upColor: "#4aaa8c",
    downColor: "#b2576c",
    borderVisible: false,
    wickUpColor: "#83d6b1",
    wickDownColor: "#ee8f9d",
  });
  markers = LightweightCharts.createSeriesMarkers(series, []);
}
function updateCandles(q) {
  if (q.candles) candles = q.candles;
  engine.state.candles = structuredClone(candles);
  engine.state.market = "binance-usdm-BTCUSDT";
  engine.state.lastQuote = { ...q };
  delete engine.state.lastQuote.candles;
  engine.state.lastMarketResponse = q.provenance;
  if (!candles.length) return;
  series?.setData(candles);
  const fills = engine.state.events.filter(
    (e) =>
      e.type === "fill" &&
      e.venue === "binance" &&
      Math.floor((e.exchangeTime || e.time) / HOUR) * 3600 >= candles[0].time,
  );
  markers?.setMarkers(
    fills.map((e) => ({
      time: Math.floor((e.exchangeTime || e.time) / HOUR) * 3600,
      position: e.direction === 1 ? "belowBar" : "aboveBar",
      color:
        e.action === "reduce" || e.action === "close"
          ? "#d6b97b"
          : e.direction === 1
            ? "#83d6b1"
            : "#ee8f9d",
      shape:
        e.action === "reduce" || e.action === "close"
          ? "circle"
          : e.direction === 1
            ? "arrowUp"
            : "arrowDown",
      text: `${names[e.action]} ${money(e.price)}${["reduce", "close"].includes(e.action) ? " / " + money(e.pnl) : ""}`,
    })),
  );
  if (!chart) drawCandles($("#fallback"));
}
function drawCandles(canvas) {
  const { ctx, w, h } = prepare(canvas);
  ctx.fillStyle = "#101923";
  ctx.fillRect(0, 0, w, h);
  if (!candles.length) return;
  const low = Math.min(...candles.map((c) => c.low)) - 50,
    high = Math.max(...candles.map((c) => c.high)) + 50;
  const y = (p) => h - 25 - ((p - low) / (high - low)) * (h - 50);
  candles.forEach((c, i) => {
    const x = 20 + (i / Math.max(candles.length, 25)) * (w - 40);
    ctx.strokeStyle = ctx.fillStyle = c.close >= c.open ? "#83d6b1" : "#ee8f9d";
    ctx.beginPath();
    ctx.moveTo(x, y(c.high));
    ctx.lineTo(x, y(c.low));
    ctx.stroke();
    ctx.fillRect(
      x - 3,
      Math.min(y(c.open), y(c.close)),
      6,
      Math.max(1, Math.abs(y(c.close) - y(c.open))),
    );
  });
  ctx.fillStyle = "#8a9bac";
  ctx.font = "12px sans-serif";
  ctx.fillText("Binance · 1H · Local chart renderer", 14, 18);
}
function prepare(c) {
  const r = c.getBoundingClientRect(),
    d = window.devicePixelRatio || 1;
  c.width = Math.max(1, r.width * d);
  c.height = Math.max(1, r.height * d);
  const ctx = c.getContext("2d");
  ctx.scale(d, d);
  return { ctx, w: r.width, h: r.height };
}
const assetsChart = createAssetsChart($('#equity'));
function drawEquity() {
  assetsChart.update(engine.state.equity, engine.config.initial);
}

function render() {
  if (!quote) return;
  const v = engine.values(quote.mark),
    s = engine.state,
    net = num(decimal(v.equity)) - num(engine.config.initial),
    wins = s.cycles.filter((c) => num(c.net) > 0).length,
    realized = num(s.balance) - num(engine.config.initial);
  const data = [
    ["Equity", money(decimal(v.equity))],
    ["Return", ((net / num(engine.config.initial)) * 100).toFixed(2) + "%"],
    ["Realized P&L", money(realized)],
    ["Unrealized P&L", money(decimal(v.unrealized))],
    [
      "Win Rate",
      s.cycles.length ? ((wins / s.cycles.length) * 100).toFixed(1) + "%" : "—",
    ],
    ["Closed Trades", String(s.cycles.length)],
  ];
  $("#metrics").replaceChildren(
    ...data.map(([label, value]) => {
      const el = document.createElement("div");
      el.className = "metric";
      const a = document.createElement("small"),
        b = document.createElement("b");
      a.textContent = label;
      b.textContent = value;
      el.append(a, b);
      return el;
    }),
  );
  $("#price").textContent = money(quote.mark) + " USDT";
  $("#position").textContent =
    `${s.direction === 1 ? "Long" : s.direction === -1 ? "Short" : "Flat"} · ${s.qty} BTC\nAvg ${money(s.average)}\nMargin ${money(decimal(v.margin))} USDT\nAvail. ${money(decimal(v.available))} USDT`;
  $("#position").style.whiteSpace = "pre-line";
  $("#trades").replaceChildren(
    ...s.events
      .slice(-100)
      .reverse()
      .map((e) => {
        const tr = document.createElement("tr");
        const vals = [
          formatBeijing(e.time),
          names[e.action || e.type] || e.type,
          e.direction === 1 ? "Long" : e.direction === -1 ? "Short" : "—",
          e.quantity || "—",
          e.price ? money(e.price) : "—",
          money(e.pnl || e.cash || 0),
          money(e.fee || 0),
        ];
        for (const val of vals) {
          const td = document.createElement("td");
          td.textContent = val;
          tr.append(td);
        }
        tr.onclick = () =>
          status(
            `${e.id} · ${formatBeijing(e.time)} · ${names[e.action || e.type]} · Binance quote / paper fill`,
          );
        return tr;
      }),
  );
  drawEquity();
}
async function persist() {
  try {
    await save(engine.export());
  } catch (e) {
    storageFailed = true;
    market.stop();
    status("Save failed; trading paused. Export a JSON backup: " + e.message);
    document
      .querySelectorAll(".actions button")
      .forEach((b) => (b.disabled = true));
  }
}
async function onQuote(q) {
  if (storageFailed || !ownsAccount) return;
  quote = q;
  try {
    $("#connection").textContent =
      `Binance connected · UTC+8 ${formatBeijing(q.exchangeTime)} · Auto refresh: 1H`;
    $("#connection").className = "notice";
    const interval = engine.config.fundingInterval,
      current = Math.floor(q.exchangeTime / interval);
    if (
      lastFundingBucket !== null &&
      current > lastFundingBucket &&
      engine.config.fundingMode === "fixed"
    ) {
      engine.funding(
        `funding-${current}`,
        q.eventTime,
        engine.config.fundingRate,
        q.mark,
      );
    }
    lastFundingBucket = current;
    const liquidation = engine.tick(q);
    if (liquidation) {
      pending = null;
      status("Paper liquidation triggered.");
    } else if (pending && q.requestStartedAt >= pending.submittedAt) {
      const intent = pending;
      pending = null;
      try {
        const event = engine.execute(intent, q);
        status(`Paper fill: ${names[event.action]} @ ${money(event.price)} USDT`);
      } catch(error) { status(`Not filled: ${error.message}`); }
    } else if (!pending) {
      status(`Binance · ${formatBeijing(q.exchangeTime)} UTC+8`);
    }
    updateCandles(q);
    render();
    await persist();
  } catch (e) {
    pending = null;
    status(e.message);
    throw e;
  }
}
for (const action of ["long", "short", "reduce", "close"])
  $("#" + action).onclick = async () => {
    if (storageFailed || !ownsAccount) return;
    if (pending) {
      status("Order pending; waiting for a fresh quote.");
      return;
    }
    pending = {
      id: crypto.randomUUID(),
      action,
      quantity: $("#quantity").value,
      submittedAt: Date.now(),
    };
    status("Fetching a fresh Binance quote for the paper fill…");
    try {
      await market.refresh({ history: true, fresh: true });
    } catch (error) {
      pending = null;
      status(`Not filled: ${error.message}`);
    }
  };
$("#backup").onclick = () =>
  download(
    new Blob([JSON.stringify(engine.export(), null, 2)], {
      type: "application/json",
    }),
    "kimra-paper-account.json",
  );
$("#settings").onsubmit = async (e) => {
  e.preventDefault();
  try {
    const config = Object.fromEntries(new FormData(e.target)),
      next = new Engine(config);
    if (
      engine.state.events.length &&
      !confirm("Have you saved a backup? Creating a new account replaces the active account.")
    )
      return;
    engine = next;
    engine.state.market = "binance-usdm-BTCUSDT";
    pending = null;
    lastFundingBucket = null;
    await persist();
    render();
    status("New paper account created.");
  } catch (err) {
    status(err.message);
  }
};
$("#restore").onchange = async (e) => {
  try {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 20000000) throw Error("Backup file is too large");
    const data = JSON.parse(await file.text());
    if (
      data.schemaVersion !== 1 ||
      data.state?.version !== 1 ||
      !Array.isArray(data.state.events) ||
      !Array.isArray(data.state.equity) ||
      !Array.isArray(data.state.cycles) ||
      !Array.isArray(data.state.seen)
    )
      throw Error("Unsupported backup format");
    if (
      data.state.market !== "binance-usdm-BTCUSDT" ||
      data.state.events.some(
        (event) => event.type === "fill" && event.venue !== "binance",
      )
    )
      throw Error("Only Binance paper accounts can be restored; demo data cannot be mixed in");
    const next = new Engine(data.config, data.state);
    next.values(quote?.mark || "68000");
    if (!confirm("Restoring will replace the active account. Continue?")) return;
    engine = next;
    engine.state.market = "binance-usdm-BTCUSDT";
    pending = null;
    lastFundingBucket = null;
    await persist();
    render();
    status("Backup restored.");
  } catch (err) {
    status("Restore failed: " + err.message);
  }
  e.target.value = "";
};
$("#report").onclick = () => {
  if (!quote) {
    status("No Binance data available for a report.");
    return;
  }
  const c = document.createElement("canvas");
  c.width = 1400;
  c.height = 1000;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#0a1018";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#98cfae";
  ctx.font = "bold 34px sans-serif";
  ctx.fillText("KIMRA / Paper Trading", 50, 65);
  ctx.fillStyle = "#e2c589";
  ctx.font = "20px sans-serif";
  ctx.fillText(
    "PAPER TRADING · NO REAL FILLS · Binance BTCUSDT perpetual data",
    50,
    105,
  );
  ctx.fillStyle = "#8a9bac";
  ctx.font = "15px sans-serif";
  ctx.fillText(
    `BTC / USDT PERP · 1H · UTC+8 ${formatBeijing(quote.exchangeTime)} · ${engine.config.leverage}x`,
    50,
    138,
  );
  const v = engine.values(quote.mark),
    net = num(decimal(v.equity)) - num(engine.config.initial),
    wins = engine.state.cycles.filter((x) => num(x.net) > 0).length;
  ctx.fillStyle = "#e7edf5";
  ctx.font = "22px sans-serif";
  ctx.fillText(
    `Equity ${money(decimal(v.equity))} USDT    Return ${((net / num(engine.config.initial)) * 100).toFixed(2)}%    Net P&L ${money(net)}    Win Rate ${engine.state.cycles.length ? ((wins / engine.state.cycles.length) * 100).toFixed(1) + "%" : "—"}`,
    50,
    190,
  );
  const image = chart ? chart.takeScreenshot(true) : $("#fallback");
  ctx.drawImage(image, 50, 225, 1300, 400);
  ctx.fillStyle = "#8a9bac";
  ctx.font = "18px sans-serif";
  ctx.fillText("Equity / USDT · UTC+8", 50, 665);
  ctx.drawImage($("#equity"), 50, 680, 1300, 180);
  const last = engine.state.events.filter((e) => e.type === "fill").at(-1);
  if (last) {
    ctx.font = "15px sans-serif";
    ctx.fillText(
      `Latest paper fill: ${names[last.action]} · ${formatBeijing(last.time)} · ${money(last.price)} USDT · Gross P&L ${money(last.pnl)}`,
      50,
      880,
    );
  }
  ctx.font = "15px sans-serif";
  ctx.fillText(
    `Initial ${engine.config.initial} · Fees ${engine.config.fee} · Slippage ${engine.config.slippage} · Funding ${engine.config.fundingMode}`,
    50,
    910,
  );
  ctx.fillText(
    "Hourly samples; fills, slippage, fees and liquidation are simulated. No continuous intrahour monitoring.",
    50,
    945,
  );
  c.toBlob((blob) => {
    if (blob) {
      download(blob, "kimra-paper-trading-report.png");
      status("Paper trading PNG report downloaded.");
    } else status("PNG report failed.");
  }, "image/png");
};
async function boot() {
  try {
    const snapshot = await load();
    if (!ownsAccount) return;
    engine = snapshot
      ? new Engine(snapshot.config, snapshot.state)
      : new Engine();
    engine.state.market = "binance-usdm-BTCUSDT";
    accountReady = true;
    candles = engine.state.candles || [];
    makeChart();
    drawEquity();
    series?.setData(candles);
    if (engine.state.lastQuote) {
      quote = engine.state.lastQuote;
      render();
    }
    await persist();
    if (!ownsAccount) return;
    status("Connecting to Binance…");
    await market.start(onQuote, (error) => {
      pending = null;
      $("#connection").textContent =
        `Binance connection failed: ${error.message}. No fallback data. Cached prices are historical; paper fills are paused.`;
      $("#connection").className = "notice negative";
      status("No market data; orders will not fill. Check the connection to Binance.");
    });
    document.addEventListener("visibilitychange", () => {
      if (
        ownsAccount &&
        document.visibilityState === "visible" &&
        market.nextUpdate &&
        Date.now() >= market.nextUpdate
      )
        market.refresh().catch(() => {});
    });
    window.addEventListener("resize", () => {
      drawEquity();
      if (!chart) drawCandles($("#fallback"));
    });
  } catch (e) {
    status("Startup failed: " + e.message);
  }
}
// Always draw saved data before waiting for the single-writer lock.
// Opening a second tab must never leave both chart panels empty.
async function showSavedAccount() {
  const snapshot = await load();
  engine = snapshot ? new Engine(snapshot.config, snapshot.state) : new Engine();
  candles = engine.state.candles || [];
  makeChart();
  series?.setData(candles);
  drawEquity();
  if (engine.state.lastQuote) {
    quote = engine.state.lastQuote;
    updateCandles(quote);
    render();
  }
}
if (accountChannel) accountChannel.onmessage = async event => {
  if (event.data !== 'request-control' || !ownsAccount || !accountReady || releasingAccount || storageFailed) return;
  releasingAccount = true;
  try {
    // Ignore an already-delivered request once no other tab is waiting.
    const locks = await navigator.locks.query();
    if (!locks.pending.some(lock => lock.name === ACCOUNT_LOCK)) return;
    ownsAccount = false;
    pending = null;
    setTradingEnabled(false);
    market.stop();
    if (market.inflight) await market.inflight.catch(() => {});
    await persist();
    if (storageFailed) return;
    accountReady = false;
    releaseAccount?.();
    releaseAccount = null;
    status('Saved view. Reload to trade in this tab.');
  } catch (error) { status('Account handover failed: ' + error.message); }
  finally { releasingAccount = false; }
};
async function startAccount() {
  setTradingEnabled(false);
  try {
    await showSavedAccount();
    if (!navigator.locks) {
      status('Read-only saved view. A current Chrome or Safari browser is required.');
      return;
    }
    status('Loading account. If another old tab is open, close it to continue.');
    const notifyOwner = () => accountChannel?.postMessage('request-control');
    const notifyTimer = setInterval(notifyOwner, 1000);
    try {
      const ownership = navigator.locks.request(ACCOUNT_LOCK, async () => {
        clearInterval(notifyTimer);
        ownsAccount = true;
        const released = new Promise(resolve => { releaseAccount = resolve; });
        setTradingEnabled(true);
        await boot();
        await released;
      });
      notifyOwner();
      await ownership;
    } finally { clearInterval(notifyTimer); }
  } catch (error) { status('Account startup failed: ' + error.message); }
}
startAccount();

$("#refresh").onclick = async () => {
  if (storageFailed || !ownsAccount) return;
  $("#refresh").disabled = true;
  status("Fetching Binance data…");
  try {
    await market.refresh({ fresh: true });
    status("Binance data updated. Hourly refresh remains scheduled.");
  } catch (error) {
    status(error.message);
  } finally {
    $("#refresh").disabled = false;
  }
};

setInterval(() => {
  const last = quote ? formatBeijing(quote.receivedAt) : "No successful update";
  const next = market.nextUpdate
    ? formatBeijing(market.nextUpdate)
    : "Connecting";
  $("#schedule").textContent =
    `UTC+8 · Last update: ${last} · Next refresh: ${next} · Paused while the browser is closed or asleep`;
}, 1000);
