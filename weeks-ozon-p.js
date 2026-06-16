require('dotenv').config();

const Ozon = require('./services/ozon');
const Excel = require('./services/excel');
const OneC = require('./services/1c');
const { formatDate, getMonStr } = require('./utils/dates');
const { createOzonWeeklySalesReportBuffer } = require('./services/excel/weeklySales');

const ozon = new Ozon();
const oneC = new OneC();

// ============================================================================
// Date / week helpers
// ============================================================================

/**
 * Returns the Monday (00:00:00.000 local) of the ISO week containing `date`.
 * Week = Monday..Sunday.
 */
function mondayOf(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  // getDay(): Sun=0, Mon=1, ... Sat=6
  const dow = d.getDay();
  const diff = dow === 0 ? -6 : 1 - dow; // shift to Monday
  d.setDate(d.getDate() + diff);
  return d;
}

/**
 * Returns the Sunday (23:59:59.999 local) of the ISO week containing `date`.
 */
function sundayOf(date) {
  const mon = mondayOf(date);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  sun.setHours(23, 59, 59, 999);
  return sun;
}

function formatDDMMYY(date) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yy = String(date.getFullYear()).slice(-2);
  return `${dd}.${mm}.${yy}`;
}

/**
 * Build list of `weeksCount` complete weeks ending on or before `endDate`.
 * Week 1 is the earliest week, week `weeksCount` is the most recent.
 * Each week runs Monday..Sunday.
 */
function buildWeeks(weeksCount, endDate) {
  // Anchor: last full week is the week whose Sunday is the most recent Sunday <= endDate.
  const anchor = new Date(endDate);
  anchor.setHours(0, 0, 0, 0);
  // Find last Sunday <= anchor
  const dow = anchor.getDay(); // 0..6
  const daysBackToSunday = dow === 0 ? 0 : dow; // Mon(1)->1, Sun(0)->0
  const lastSunday = new Date(anchor);
  lastSunday.setDate(anchor.getDate() - daysBackToSunday);
  lastSunday.setHours(23, 59, 59, 999);

  const weeks = [];
  for (let i = weeksCount - 1; i >= 0; i--) {
    const sun = new Date(lastSunday);
    sun.setDate(lastSunday.getDate() - i * 7);
    sun.setHours(23, 59, 59, 999);
    const mon = new Date(sun);
    mon.setDate(sun.getDate() - 6);
    mon.setHours(0, 0, 0, 0);
    weeks.push({ fromDate: mon, toDate: sun });
  }
  // Label + index
  return weeks.map((w, idx) => ({
    index: idx + 1,
    label: `НЕДЕЛЯ ${idx + 1} (${formatDDMMYY(w.fromDate)}-${formatDDMMYY(w.toDate)})`,
    fromDate: w.fromDate,
    toDate: w.toDate
  }));
}

// ============================================================================
// offer_id -> parent article normalization
// ============================================================================

// Recognized size suffixes (trailing) — case-insensitive check.
// Covers S..XXXL, 2XL..6XL and numeric 2-digit sizes (36..60 etc).
const SIZE_SUFFIX_RE = /^(X{0,4}S|X{0,4}M|X{0,4}L|[2-9]XL|[2-9]XS|\d{2})$/i;

/**
 * Strip trailing size suffix like "-L", "-XL", "-XXL", "-42" from an offer_id.
 * Examples:
 *   D81250-L   -> D81250
 *   D81250-XXL -> D81250
 *   D81250     -> D81250
 *   FOO-BAR    -> FOO-BAR (BAR not a recognized size)
 */
function extractParentArticle(offerId) {
  if (!offerId || typeof offerId !== 'string') return offerId || '';
  const m = offerId.match(/^(.+?)[-_/]([A-Za-z0-9]{1,5})$/);
  if (m && SIZE_SUFFIX_RE.test(m[2])) {
    return m[1];
  }
  return offerId;
}

/**
 * Normalize variant name to parent name by stripping trailing size (e.g. ", L" / " XL").
 */
function normalizeParentName(name) {
  if (!name || typeof name !== 'string') return name || '';
  return name
    .replace(/[,\s]+(X{0,4}S|X{0,4}M|X{0,4}L|[2-9]XL|[2-9]XS|\d{2})\s*$/i, '')
    .trim();
}

// ============================================================================
// 1C merge (brand/group/subgroup/price/cost/amount)
// ============================================================================

function build1CIndex(oneCStocks) {
  const byArticul = {};
  oneCStocks.forEach(item => {
    byArticul[item.Articul] = {
      price: item.Price ? parseFloat(String(item.Price).replace(',', '.')) : null,
      cost: item.CenaSeb && String(item.CenaSeb).trim() !== ''
        ? parseFloat(String(item.CenaSeb).replace(',', '.'))
        : null,
      amount: typeof item.Amount === 'number'
        ? item.Amount
        : (item.Amount ? parseFloat(String(item.Amount).replace(',', '.')) : 0),
      brand: item.Brand || '',
      group: item.Group || '',
      subgroup: item.Subgroup || ''
    };
  });
  return byArticul;
}

// ============================================================================
// Buyout determination
// ============================================================================

/**
 * We treat an Ozon FBO posting as a "выкуп" when its status is 'delivered',
 * i.e. the order was delivered to the customer and the sale was finalized.
 *
 * Rationale:
 *   - Ozon FBO posting statuses: awaiting_packaging, awaiting_deliver,
 *     delivering, delivered, cancelled.
 *   - 'delivered' is the only status that represents a finalized / paid-out sale.
 *   - We do NOT silently fall back to all non-cancelled orders: if status is
 *     missing we leave buyout fields as 0 for that row.
 *
 * Both "order" and "buyout" aggregates are attributed to the week of the
 * order creation date (in_process_at) so they are directly comparable.
 */
function isBuyoutOrder(order) {
  return order && order.status === 'delivered';
}

// ============================================================================
// Data calculation
// ============================================================================

function getOrderCreatedAt(order) {
  // Ozon FBO orders use `in_process_at` (ISO string). Fallback to created_at.
  const raw = order.in_process_at || order.created_at || order.order_date;
  if (!raw) return null;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return null;
  return d;
}

function findWeekIndex(weeks, date) {
  if (!date) return -1;
  const t = date.getTime();
  for (let i = 0; i < weeks.length; i++) {
    if (t >= weeks[i].fromDate.getTime() && t <= weeks[i].toDate.getTime()) {
      return i;
    }
  }
  return -1;
}

function emptyWeekSlot() {
  return {
    order_amount: 0,
    order_qty: 0,
    buyout_amount: 0,
    buyout_qty: 0
  };
}

async function calculateWeeklySalesData(weeksCount = 13, endDate) {
  if (!endDate) {
    const now = new Date();
    endDate = new Date(now);
    endDate.setDate(now.getDate() - 1); // yesterday
    endDate.setHours(23, 59, 59, 999);
  } else if (!(endDate instanceof Date)) {
    endDate = new Date(endDate);
  }

  const weeks = buildWeeks(weeksCount, endDate);
  const rangeFrom = weeks[0].fromDate;
  const rangeTo = weeks[weeks.length - 1].toDate;

  console.log(`[weeks-ozon] Weekly report: ${weeksCount} week(s), ` +
    `${formatDDMMYY(rangeFrom)} .. ${formatDDMMYY(rangeTo)}`);

  // 1) Orders (FBO) for the whole weekly range
  const fboOrders = await ozon.getAllFboOrders(rangeFrom.toISOString(), rangeTo.toISOString());
  console.log(`[weeks-ozon] Fetched ${fboOrders.length} FBO orders`);

  // 2) Current stocks (FBO)
  const allStocks = await ozon.getAllStocks();
  console.log(`[weeks-ozon] Fetched ${allStocks.length} stock entries`);

  // 3) Catalog for names
  const allProducts = await ozon.getAllProducts();
  const offerIdToName = allProducts.reduce((m, p) => {
    m[p.offer_id] = p.name;
    return m;
  }, {});

  // 4) 1C (brand/group/subgroup/price/cost/amount)
  const oneCStocks = await oneC.getStock();
  console.log(`[weeks-ozon] Fetched ${oneCStocks.length} 1C stock entries`);
  const oneCIndex = build1CIndex(oneCStocks);

  // --------------------------------------------------------------------------
  // Aggregate current FBO stock by offer_id.
  // NOTE: historical per-week FBO snapshots are not available, so current
  // snapshot is used for every week. See Meta sheet in XLSX for disclosure.
  // --------------------------------------------------------------------------
  const fboStockByOfferId = {};
  allStocks.forEach(s => {
    const oid = s.offer_id || s.item_code;
    if (!oid) return;
    const amount = (s.free_to_sell_amount || 0) +
      (s.reserved_amount || 0) +
      (s.promised_amount || 0);
    fboStockByOfferId[oid] = (fboStockByOfferId[oid] || 0) + amount;
  });

  // --------------------------------------------------------------------------
  // Walk orders and aggregate per offer_id per week.
  // --------------------------------------------------------------------------
  const itemsByOfferId = {};

  function ensureItem(offerId) {
    if (!itemsByOfferId[offerId]) {
      const parentArticle = extractParentArticle(offerId);
      const catalogName = offerIdToName[offerId] || '';
      const one = oneCIndex[offerId] || null;
      itemsByOfferId[offerId] = {
        offer_id: offerId,
        parent_article: parentArticle,
        parent_name: '', // filled after pass, based on group
        subgroup: one ? one.subgroup : '',
        brand: one ? one.brand : '',
        group: one ? one.group : '',
        name: catalogName,
        _catalogName: catalogName,
        smile_stock: one ? (one.amount || 0) : 0,
        fbo_stock: fboStockByOfferId[offerId] || 0,
        weekSlots: weeks.map(() => emptyWeekSlot())
      };
    }
    return itemsByOfferId[offerId];
  }

  fboOrders.forEach(order => {
    const createdAt = getOrderCreatedAt(order);
    const wi = findWeekIndex(weeks, createdAt);
    if (wi < 0) return; // outside reporting window
    if (order.status === 'cancelled') return; // cancelled orders do not count

    const products = order.products || [];
    const isBuyout = isBuyoutOrder(order);

    products.forEach(p => {
      const offerId = p.offer_id;
      if (!offerId) return;
      const item = ensureItem(offerId);
      if (!item.name && p.name) {
        item.name = p.name;
        item._catalogName = item._catalogName || p.name;
      }

      const qty = Number(p.quantity) || 0;
      const price = p.price != null ? parseFloat(p.price) : 0;
      const amount = qty * price;

      const slot = item.weekSlots[wi];
      slot.order_qty += qty;
      slot.order_amount += amount;
      if (isBuyout) {
        slot.buyout_qty += qty;
        slot.buyout_amount += amount;
      }
    });
  });

  // Include stock-only products (present in FBO stock but with no sales in period)
  Object.keys(fboStockByOfferId).forEach(oid => {
    if (!itemsByOfferId[oid]) ensureItem(oid);
  });
  // Include 1C-only products? Skip: would explode report with zeros; only
  // include items that have sales or FBO stock, matching existing Ozon reports.

  // --------------------------------------------------------------------------
  // Derive parent_name per parent_article group.
  // --------------------------------------------------------------------------
  const parentNameByArticle = {};
  Object.values(itemsByOfferId).forEach(it => {
    const pa = it.parent_article;
    if (!parentNameByArticle[pa]) {
      // prefer normalized variant name, else catalog name normalized
      const base = normalizeParentName(it._catalogName || it.name);
      if (base) parentNameByArticle[pa] = base;
    }
  });
  Object.values(itemsByOfferId).forEach(it => {
    it.parent_name = parentNameByArticle[it.parent_article] || normalizeParentName(it.name) || it.parent_article;
    delete it._catalogName;
  });

  // --------------------------------------------------------------------------
  // Compute per-week derived metrics (avg price) and week-over-week deltas.
  // --------------------------------------------------------------------------
  const items = Object.values(itemsByOfferId).map(it => {
    const weekRows = it.weekSlots.map((slot, wi) => {
      const prev = wi > 0 ? it.weekSlots[wi - 1] : null;

      let avg = null;
      if (slot.buyout_qty > 0) {
        avg = slot.buyout_amount / slot.buyout_qty;
      } else if (slot.order_qty > 0) {
        avg = slot.order_amount / slot.order_qty;
      }

      let prevAvg = null;
      if (prev) {
        if (prev.buyout_qty > 0) prevAvg = prev.buyout_amount / prev.buyout_qty;
        else if (prev.order_qty > 0) prevAvg = prev.order_amount / prev.order_qty;
      }

      const pct = (cur, base) => {
        if (base == null || base === 0) return null;
        return (cur - base) / base;
      };

      return {
        order_amount: slot.order_amount,
        order_qty: slot.order_qty,
        buyout_amount: slot.buyout_amount,
        buyout_qty: slot.buyout_qty,
        order_amount_pct: prev ? pct(slot.order_amount, prev.order_amount) : null,
        buyout_amount_pct: prev ? pct(slot.buyout_amount, prev.buyout_amount) : null,
        smile_stock: it.smile_stock,
        fbo_stock: it.fbo_stock,
        avg_week_price: avg,
        avg_week_price_pct: prev ? pct(avg, prevAvg) : null
      };
    });

    return {
      offer_id: it.offer_id,
      parent_article: it.parent_article,
      parent_name: it.parent_name,
      subgroup: it.subgroup,
      brand: it.brand,
      group: it.group,
      name: it.name,
      weeks: weekRows
    };
  });

  // Sort by parent_article then offer_id for stable output
  items.sort((a, b) => {
    if (a.parent_article !== b.parent_article) {
      return a.parent_article.localeCompare(b.parent_article);
    }
    return a.offer_id.localeCompare(b.offer_id);
  });

  console.log(`[weeks-ozon] Prepared ${items.length} item rows`);
  console.log(`[weeks-ozon] Total Ozon API calls: ${ozon.getApiCallCount()}`);

  return {
    weeks: weeks.map(w => ({
      index: w.index,
      label: w.label,
      fromDate: w.fromDate.toISOString(),
      toDate: w.toDate.toISOString()
    })),
    items,
    fromDate: rangeFrom,
    toDate: rangeTo
  };
}

// ============================================================================
// Report generation
// ============================================================================

async function weeklySalesReport(weeksCount = 13, endDate) {
  const fs = require('fs').promises;
  const path = require('path');

  const data = await calculateWeeklySalesData(weeksCount, endDate);

  const now = new Date();
  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  const mon = getMonStr(now);
  const stamp = `${formatDate(now)}_${hours}h${minutes}m_${weeksCount}weeks`;

  const outputDir = path.join(process.cwd(), 'reports', 'ozon', mon);
  await fs.mkdir(outputDir, { recursive: true });
  console.log(`[weeks-ozon] Using directory: ${outputDir}`);

  const buffer = await createOzonWeeklySalesReportBuffer(data, {
    buyoutRule: "status === 'delivered'",
    snapshotDisclosure: 'Остатки Смайл и FBO — текущий snapshot, применён ко всем неделям'
  });

  const fname = path.join(outputDir, `ozon_weekly_sales_${stamp}.xlsx`);
  await fs.writeFile(fname, buffer);
  console.log(`[weeks-ozon] Saved: ${fname}`);

  console.log('\n=== Weekly Sales Report Summary ===');
  console.log(`Weeks: ${data.weeks.length}`);
  console.log(`Items: ${data.items.length}`);
}

module.exports = {
  calculateWeeklySalesData,
  weeklySalesReport,
  // exposed for unit tests / reuse
  extractParentArticle,
  normalizeParentName,
  buildWeeks,
  isBuyoutOrder
};

// CLI: node weeks-ozon.js [weeksCount] [endDate=YYYY-MM-DD]
if (require.main === module) {
  const args = process.argv.slice(2);
  const weeksCount = args.length > 0 ? parseInt(args[0], 10) : 13;
  const endDateArg = args.length > 1 ? args[1] : null;
  const endDate = endDateArg ? new Date(endDateArg) : null;

  weeklySalesReport(weeksCount, endDate)
    .then(() => {
      console.log('\n✓ Ozon weekly sales report generation complete');
      process.exit(0);
    })
    .catch(error => {
      console.error('Error generating Ozon weekly sales report:', error);
      process.exit(1);
    });
}
