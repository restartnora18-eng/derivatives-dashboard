'use strict';
const modules = [
  ['overview','◈','总览','关键指标与数据覆盖'],
  ['funding','↗','资金费率','排名、跨所比较与资金成本'],
  ['oi','◎','未平仓量','仓位规模、变化与多空结构'],
  ['basis','⌁','基差与期限','现货价差与期货期限结构'],
  ['liquidations','ϟ','强平','多空出清与事件分布'],
  ['options','◇','期权与波动率','IV、偏斜、期限结构与 Greeks'],
  ['orderbook','▤','订单簿与流动性','盘口深度、价差与订单流'],
];
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct = (n, digits = 2) => Number.isFinite(n) ? (n >= 0 ? '+' : '') + n.toFixed(digits) + '%' : '—';
const tone = n => !Number.isFinite(n) ? 'hint' : n >= 0 ? 'good' : 'bad';
const date = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN', {timeZone:'Asia/Shanghai',hour12:false}) + ' 北京时间' : '暂无';
const statusLabels = {ok:'采集成功', warning:'字段待核验', partial:'部分失败', failed:'采集失败', missing:'原快照缺失', legacy:'历史快照'};
const kindLabels = {published_current:'接口当前值', estimated_upcoming:'待结算估计值', legacy:'原年化口径'};
let dataset = window.FUNDING_DATA?.last_attempt ? 'collected' : 'legacy';
let expiryTimer;
let previousRoute;
if ('scrollRestoration' in history) history.scrollRestoration='manual';
document.querySelector('#nav').innerHTML = modules.map(([id,icon,name]) => `<a href="#${id}" data-id="${id}">${icon}　${name}</a>`).join('');
const content = document.querySelector('#content');

function getView() {
  return dataset === 'legacy' ? FundingModel.legacy(SNAPSHOT) : FundingModel.live(window.FUNDING_DATA);
}

function render() {
  let id = location.hash.slice(1) || 'overview';
  if (!modules.some(m => m[0] === id)) id = 'overview';
  if(previousRoute!==id){window.scrollTo(0,0);previousRoute=id;}
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('active', a.dataset.id === id));
  document.body.classList.toggle('terminal-view', (id==='funding'||id==='basis'||id==='orderbook'||id==='liquidations'||id==='overview'||id==='oi'));
  document.body.classList.toggle('overview-view', id==='overview');
  const mod = modules.find(m => m[0] === id);
  document.querySelector('#title').textContent = id === 'overview' ? '看见价格背后的仓位' : mod[2];
  document.querySelector('#intro').textContent = id === 'overview' ? '从资金成本出发，逐步建立自己的衍生品市场视角。' : mod[3];
  const view = getView();
  const isLegacy = dataset === 'legacy';
  clearTimeout(expiryTimer);
  if (!isLegacy) {
    const now = Date.now();
    const deadlines = view.rows.flatMap(row => [Date.parse(row.source_time) + view.max_source_age_seconds * 1000, Date.parse(row.funding_time)])
      .filter(time => Number.isFinite(time) && time > now);
    if (deadlines.length) expiryTimer = setTimeout(render, Math.min(...deadlines) - now + 50);
  }
  const stale = !isLegacy && view.rows.some(row => row.warnings.includes('source_stale'));
  const cadenceLabel = window.DASHBOARD_RUNTIME?.hosted ? '云端约每小时更新 · 刷新网页读取最新快照' : '按需采集快照 · 当前不自动刷新';
  document.querySelector('#notice-label').textContent = isLegacy ? '◷ 原项目历史快照演示 · 非实时行情' :
    view.retained ? '◷ 本次采集全部失败 · 以下保留上次快照' : stale ? '◷ 快照已过期 · ' + cadenceLabel : '◷ ' + cadenceLabel;
  document.querySelector('#time').textContent = '数据时间：' + date(view.captured);
  document.querySelector('#methodology').textContent = isLegacy ?
    '演示数据沿用原项目 8 小时年化假设，实际周期未核验。' :
    '年化 = 周期费率 × 24 ÷ 周期小时数 × 365。仅作线性外推；周期未知不计算，过期或异常记录不参与有效排名。';
  if (id === 'overview') {
    document.querySelector('#notice-label').textContent = '◷ 六指标同屏 · 云端小时快照';
    document.querySelector('#time').textContent = '各图按来源时间标注';
    window.renderOverviewWall(content);
    return;
  }
  if (id === 'funding') {
    window.renderFundingMatrix(content,view,{onDataset:value=>{dataset=value;render();}});
    return;
  }
  if (id === 'liquidations') {
    document.querySelector('#time').textContent = '样本尝试时间：' + date(window.LIQUIDATIONS_DATA?.attempted_at);
    document.querySelector('#notice-label').textContent = '◷ 实验性强平样本 · 不代表完整强平总量';
    document.querySelector('#methodology').textContent = '仅限有界REST观察样本，接口已退出正式文档；不换算或展示全市场强平金额。';
    window.renderLiquidationHeatmap(content);
    return;
  }
  if (id === 'orderbook') {
    document.querySelector('#time').textContent = '盘口尝试时间：' + date(window.ORDERBOOK_DATA?.attempted_at);
    document.querySelector('#notice-label').textContent = '◷ 盘口小时快照 · 非实时盘口';
    document.querySelector('#methodology').textContent = 'USDT永续最多400档/侧；范围不足只展示观察下限，不计算完整区间失衡。';
    window.renderLiquidity(content);
    return;
  }
  if (id === 'options') {
    document.querySelector('#time').textContent = '期权尝试时间：' + date(window.OPTIONS_DATA?.attempted_at);
    document.querySelector('#notice-label').textContent = '◷ 期权小时快照 · 刷新页面读取最新数据';
    document.querySelector('#methodology').textContent = '期权 IV 与 25Δ RR 为明确合约与到期日的近似统计；不是恒定期限指数或交易信号。';
    window.renderOptions(content);
    return;
  }
  if (id === 'basis') {
    document.querySelector('#time').textContent = '交割合约尝试时间：' + date(window.FUTURES_DATA?.attempted_at);
    document.querySelector('#notice-label').textContent = '◷ 基差小时快照 · 刷新页面读取最新数据';
    document.querySelector('#methodology').textContent = '永续溢价 =（标记价格 / 同币种 USDT 指数 − 1）× 100%；交割合约简单年化按实际剩余天数计算，非实际收益。';
    window.renderBasis(content);
    return;
  }
  if (id === 'oi') {
    document.querySelector('#time').textContent = 'Binance 数据请求：' + date(window.BINANCE_OI_MINUTES_DATA?.attempted_at);
    document.querySelector('#methodology').textContent = 'OI：单一交易所 USDT 永续合约；原始单位分别展示，不推断多空方向。';
    document.querySelector('#notice-label').textContent = '◷ Binance BTCUSDT · 每5分钟自动更新 · 北京时间 UTC+8';
    window.renderMinuteOI(content);
    return;
  }
  if (!['overview','funding'].includes(id)) {
    content.innerHTML = `<section class="panel"><span class="badge">待接入 · 后续阶段</span><h2 style="margin-top:28px">${mod[2]}分析</h2><p>${mod[3]}</p><div class="empty">此模块尚未连接数据源，无可展示的真实指标。</div><p>先完成资金费率的数据校验与历史流程，再逐项接入。</p><a class="good" href="#overview">← 返回总览</a></section>`;
    return;
  }
  const ranked = view.rows.filter(row => row.eligible).map(row => row.rate);
  const high = ranked.length ? Math.max(...ranked) : null;
  const low = ranked.length ? Math.min(...ranked) : null;
  const available = Object.values(view.statuses).filter(state => state.received > 0).length;
  const heading = isLegacy ? '原年化口径' : '有效记录';
  content.innerHTML = `
    ${id==='overview'?'<section id="percentile-panel" class="panel"></section><section id="summary-panel" class="panel"></section>':''}
    <div class="datasetbar"><label for="dataset">数据集</label><select id="dataset"><option value="collected" ${!isLegacy?'selected':''}>BTC / ETH · 按需采集</option><option value="legacy" ${isLegacy?'selected':''}>原项目 · 历史演示快照</option></select><span class="hint">${isLegacy?'仅用于参考页面与原始排名':'范围：四家交易所 · USDT 线性永续 · 无账户连接'}</span></div>
    <div class="stats">
      <div class="stat"><div class="label">快照记录</div><div class="value">${view.rows.length.toLocaleString()}</div><div class="hint">${isLegacy?'含非加密标的':'BTC / ETH，每家最多 2 条'}</div></div>
      <div class="stat"><div class="label">本次有返回的交易所</div><div class="value">${available}<span style="font-size:16px;color:#819382"> / 4</span></div><div class="hint">可用性与质量见下方状态</div></div>
      <div class="stat"><div class="label">最高年化 · ${heading}</div><div class="value ${tone(high)}">${pct(high)}</div><div class="hint">${isLegacy?'周期未核验':'异常与过期记录不计入'}</div></div>
      <div class="stat"><div class="label">最低年化 · ${heading}</div><div class="value ${tone(low)}">${pct(low)}</div><div class="hint">${isLegacy?'周期未核验':ranked.length+' 条记录参与有效排名'}</div></div>
    </div>
    <section class="panel"><h2>数据覆盖与采集状态</h2><p class="hint">${isLegacy?'历史快照只记录数据缺失，没有保存失败原因。':'最近尝试：'+date(view.attempted)+'。状态代表本次尝试；表格数据时间另行显示。'}</p>
      <div class="venue-grid">${FundingModel.venueNames.map(venue => {
        const state = view.statuses[venue] || {status:'missing',received:0,errors:[]};
        const errors = [...new Set(state.errors.map(e => e.code + ' · ' + e.message))];
        return `<div class="venue-state"><strong>${venue.toUpperCase()}</strong><span class="${state.status==='ok'?'good':state.status==='failed'?'bad':'hint'}">${statusLabels[state.status] || '尚未采集'} · ${state.received} 条</span>${errors.map(e=>`<small>${esc(e)}</small>`).join('')}</div>`;
      }).join('')}</div>
      ${view.retained?'<p class="bad">本次未取得数据。保留快照与本次失败状态分别显示，旧数据未伪装成新数据。</p>':''}
    </section>
    <section class="panel"><div class="panelhead"><div><h2>资金费率观察</h2><p>正值：多头支付空头 · 负值：空头支付多头</p></div><span class="pill">${isLegacy?'历史演示':'采集快照 · 未结算值'}</span></div>
    <div class="controls"><input id="search" type="search" aria-label="搜索标的或合约" placeholder="搜索 BTC、ETH 或完整合约…"><select id="venue" aria-label="交易所"><option value="all">全部交易所</option>${FundingModel.venueNames.map(v=>`<option value="${v}">${v.toUpperCase()}</option>`).join('')}</select><select id="sort" aria-label="排序"><option value="high">年化：从高到低</option><option value="low">年化：从低到高</option><option value="name">标的：A—Z</option></select></div>
    <div id="count" class="hint" aria-live="polite"></div><div class="tablewrap"><table><thead><tr><th>排名</th><th>标的 / 合约</th><th>交易所</th><th>周期费率</th><th>周期</th><th>年化</th><th>口径 / 质量</th><th>查看</th></tr></thead><tbody id="rows"></tbody></table></div><div id="pager" class="controls"></div><div id="detail" class="detail hidden"></div></section>
    <section id="history-panel" class="panel"></section>
    ${id==='overview'?`<div class="panelhead" style="margin-bottom:16px"><h2>分析模块</h2><span class="hint">循序接入 · 每个指标都可追溯</span></div><div class="modules">${modules.slice(1).map(([i,icon,n,d],k)=>`<a class="module" href="#${i}"><span class="number">0${k+1} / ${icon}</span><span class="status">${i==='funding'?'快照与历史已接入':i==='oi'?'小时快照已接入':i==='basis'?'溢价与交割已接入':i==='options'?'IV 与偏斜已接入':i==='orderbook'?'盘口快照已接入':i==='liquidations'?'实验性样本已接入':'待接入'}</span><h3>${n} ↗</h3><p>${d}</p></a>`).join('')}</div>`:''}`;
  if (id==='overview') {window.renderSummary(document.querySelector('#summary-panel'));window.renderPercentiles(document.querySelector('#percentile-panel'));}
  document.querySelector('#dataset').onchange = event => {dataset=event.target.value;render();};
  let page=0;
  function draw() {
    const filtered = FundingModel.select(view.rows, document.querySelector('#search').value,
      document.querySelector('#venue').value, document.querySelector('#sort').value);
    const pages=Math.max(1,Math.ceil(filtered.length/20));
    page=Math.min(page,pages-1);
    document.querySelector('#count').textContent=`匹配 ${filtered.length} 条 · 每页 20 条 · ${isLegacy?'原项目口径，仅供演示':'周期与时间异常的记录不赋予排名'}`;
    document.querySelector('#rows').innerHTML=filtered.slice(page*20,page*20+20).map((r,k)=>`<tr><td class="hint">${r.eligible?String(page*20+k+1).padStart(2,'0'):'—'}</td><td class="coin">${esc(r.symbol)}<small class="contract">${esc(r.contract)}</small></td><td><span class="pill">${r.venue.toUpperCase()}</span></td><td class="${tone(r.rate_percent)}">${pct(r.rate_percent,5)}</td><td>${r.interval_hours?r.interval_hours+'h':'未核验'}</td><td class="${tone(r.rate)}">${pct(r.rate)}</td><td class="quality">${kindLabels[r.rate_kind] || '未知口径'}<small>${isLegacy?'原假设：8h':r.warnings.map(w=>FundingModel.warningLabels[w]||w).join('、')||'周期字段有效'}</small></td><td><button data-symbol="${esc(r.symbol)}" data-venue="${r.venue}">详情 ↗</button></td></tr>`).join('')||'<tr><td colspan="8" class="empty">此筛选下暂无数据。缺失不等于零费率。</td></tr>';
    document.querySelector('#pager').innerHTML=`<button id="prev" ${page===0?'disabled':''}>← 上一页</button><span class="hint" style="padding:11px">${page+1} / ${pages}</span><button id="next" ${page===pages-1?'disabled':''}>下一页 →</button>`;
    document.querySelector('#prev').onclick=()=>{page--;draw();};
    document.querySelector('#next').onclick=()=>{page++;draw();};
    document.querySelectorAll('[data-symbol]').forEach(button=>button.onclick=()=>{
      const detail=document.querySelector('#detail');
      detail.classList.remove('hidden');
      const r=view.rows.find(r=>r.symbol===button.dataset.symbol&&r.venue===button.dataset.venue);
      const comparisons=view.rows.filter(x=>x.symbol===r.symbol&&(isLegacy||x.eligible));
      detail.innerHTML=`<strong>${esc(r.symbol)} · ${r.venue.toUpperCase()}</strong><p>完整合约：${esc(r.contract)} · ${kindLabels[r.rate_kind]}</p><p>周期费率：${pct(r.rate_percent,6)} · 周期：${r.interval_hours?r.interval_hours+' 小时':'未知'} · 线性年化：${pct(r.rate)}</p>
        ${!isLegacy?`<p>接口时间：${date(r.source_time)}<br>本机采集时间：${date(r.fetched_at)}<br>${r.funding_time_label==='next_update'?'下次更新时间':'结算时间'}：${date(r.funding_time)}</p><p>周期依据：${esc(r.interval_source)}<br>费率字段：${esc(r.source_rate_field)}<br>来源：${esc(r.source_endpoint)}</p>`:'<p>原快照没有保存原始费率、完整合约与实际周期，不能据此恢复真实结算记录。</p>'}
        <p>${['BTC','ETH'].includes(r.symbol)?'<button id="open-history">查看该合约的已结算历史 ↓</button>':'当前历史模块仅接入 BTC / ETH。'}</p><p>${isLegacy?'同名标的演示比较，合约等价性未核验':'同标的有效快照比较，采集时间与估计口径可能不同'}：${comparisons.length?comparisons.map(x=>esc(x.venue)+' '+pct(x.rate)).join(' / '):'暂无可比较的有效记录'}</p>`;
      const historyButton=document.querySelector('#open-history');
      if(historyButton)historyButton.onclick=()=>showContractHistory(r.symbol,r.venue);
      detail.scrollIntoView({behavior:'smooth',block:'nearest'});
    });
  }
  for(const id of ['search','venue','sort']) document.getElementById(id).addEventListener(id==='search'?'input':'change',()=>{page=0;document.querySelector('#detail').classList.add('hidden');draw();});
  draw();
  mountHistory();
}
window.addEventListener('hashchange', render);
// Refresh on returning and at the next expiry only. No network polling.
document.addEventListener('visibilitychange', () => {if (!document.hidden) render();});
render();
