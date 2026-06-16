require('dotenv').config();

const Ozon = require('./services/ozon');
const Excel = require('./services/excel');
const OneC = require('./services/1c');
const { getMonStr, formatDate } = require('./utils/dates');
const path = require('path');
const fs = require('fs').promises;

const ozon = new Ozon();
const oneC = new OneC();

// Strip trailing clothing/shoe size suffix: "D81250-XL" → "D81250", "D82050-41" → "D82050"
// Only strips recognized size patterns to avoid mangling catalog numbers like "01-517"
const SIZE_SUFFIX = /^(XS|S|M|L|XL|XXL|XXXL|[2-9]XL|\d{2}(-\d{2})?)$/i;

function extractParentArticle(offerId) {
  const dashIdx = offerId.lastIndexOf('-');
  if (dashIdx === -1) return offerId;
  const suffix = offerId.slice(dashIdx + 1);
  return SIZE_SUFFIX.test(suffix) ? offerId.slice(0, dashIdx) : offerId;
}

function formatWeekDate(date) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yy = String(date.getFullYear()).slice(2);
  return `${dd}.${mm}.${yy}`;
}

// Build weeksCount complete Mon–Sun weeks ending at the last Sunday before endDate
function buildWeeks(weeksCount, endDate) {
  const dow = endDate.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const daysToLastSunday = dow === 0 ? 0 : dow;

  const lastSunday = new Date(endDate);
  lastSunday.setDate(lastSunday.getDate() - daysToLastSunday);
  lastSunday.setHours(23, 59, 59, 999);

  const weeks = [];
  for (let i = weeksCount - 1; i >= 0; i--) {
    const weekEnd = new Date(lastSunday);
    weekEnd.setDate(weekEnd.getDate() - i * 7);

    const weekStart = new Date(weekEnd);
    weekStart.setDate(weekStart.getDate() - 6);
    weekStart.setHours(0, 0, 0, 0);

    const index = weeksCount - i;
    weeks.push({
      index,
      label: `НЕДЕЛЯ ${index} (${formatWeekDate(weekStart)}-${formatWeekDate(weekEnd)})`,
      fromDate: weekStart,
      toDate: weekEnd
    });
  }

  return weeks;
}

// Build 1C lookup indexed by Articul
function build1CLookup(oneCStocks) {
  const lookup = {};
  oneCStocks.forEach(item => {
    lookup[item.Articul] = {
      amount: item.Amount || 0,
      brand: item.Brand || '',
      group: item.Group || '',
      subgroup: item.Subgroup || ''
    };
  });
  return lookup;
}

async function calculateWeeklySalesData(weeksCount = 13, endDate = null) {
  if (!endDate) {
    endDate = new Date();
    endDate.setDate(endDate.getDate() - 1);
    endDate.setHours(23, 59, 59, 999);
  }

  const weeks = buildWeeks(weeksCount, endDate);
  const fromDate = weeks[0].fromDate;
  const toDate = weeks[weeks.length - 1].toDate;

  console.log(`Weekly report: ${weeks[0].label} → ${weeks[weeksCount - 1].label}`);

  // Fetch FBO orders per week (one API call per week to avoid needing created_at field)
  // Buyout = status "delivered" (confirmed delivery to customer per Ozon FBO status model)
  // Note: status reflects current state at query time, not historical week-end state
  const weekOrdersMap = {}; // weekIndex → { offerId → { order_amount, order_qty, buyout_amount, buyout_qty, name } }

  for (const week of weeks) {
    console.log(`Fetching FBO orders for ${week.label}...`);
    const orders = await ozon.getAllFboOrders(week.fromDate.toISOString(), week.toDate.toISOString());

    const byOfferId = {};
    orders.forEach(order => {
      const isBuyout = order.status === 'delivered';
      const isCancelled = order.status === 'cancelled';

      order.products.forEach(product => {
        const offerId = product.offer_id;
        if (!byOfferId[offerId]) {
          byOfferId[offerId] = { order_amount: 0, order_qty: 0, buyout_amount: 0, buyout_qty: 0, name: product.name || '' };
        }

        const price = parseFloat(product.price) || 0;
        const qty = product.quantity || 0;
        const entry = byOfferId[offerId];

        if (!isCancelled) {
          entry.order_amount += price * qty;
          entry.order_qty += qty;
        }

        if (isBuyout) {
          entry.buyout_amount += price * qty;
          entry.buyout_qty += qty;
        }

        if (!entry.name) entry.name = product.name || '';
      });
    });

    weekOrdersMap[week.index] = byOfferId;
  }

  // Current FBO stock snapshot (no historical data available; same value shown for all weeks)
  const allStocks = await ozon.getAllStocks();
  console.log(`Found ${allStocks.length} stock records`);

  const fboStockByOfferId = {};
  allStocks.forEach(stock => {
    const offerId = stock.item_code;
    if (!fboStockByOfferId[offerId]) fboStockByOfferId[offerId] = 0;
    fboStockByOfferId[offerId] += (stock.free_to_sell_amount || 0) +
      (stock.reserved_amount || 0) +
      (stock.promised_amount || 0);
  });

  // Ozon catalog names
  const allProducts = await ozon.getAllProducts();
  const offerIdToName = allProducts.reduce((map, p) => {
    map[p.offer_id] = p.name;
    return map;
  }, {});

  // 1C hierarchy and smile stock (current snapshot; same for all weeks)
  const oneCStocks = await oneC.getStock();
  console.log(`Found ${oneCStocks.length} products in 1C`);
  const oneCLookup = build1CLookup(oneCStocks);

  // Collect all offer_ids that appear in orders or FBO stock
  const allOfferIds = new Set([
    ...Object.values(weekOrdersMap).flatMap(m => Object.keys(m)),
    ...Object.keys(fboStockByOfferId)
  ]);

  // Build items with weekly metrics
  const items = [];
  for (const offerId of allOfferIds) {
    const fbo_stock = fboStockByOfferId[offerId] || 0;
    const oneCData = oneCLookup[offerId] || {};
    const smile_stock = oneCData.amount || 0;
    const catalogName = offerIdToName[offerId] || '';

    // Resolve name: prefer catalog, fall back to order data
    let resolvedName = catalogName;
    if (!resolvedName) {
      for (const week of weeks) {
        const wd = weekOrdersMap[week.index]?.[offerId];
        if (wd?.name) { resolvedName = wd.name; break; }
      }
    }

    const weekMetrics = [];
    let prevMetrics = null;

    for (const week of weeks) {
      const wd = weekOrdersMap[week.index]?.[offerId] || { order_amount: 0, order_qty: 0, buyout_amount: 0, buyout_qty: 0 };

      const avg_week_price = wd.buyout_qty > 0
        ? wd.buyout_amount / wd.buyout_qty
        : wd.order_qty > 0
        ? wd.order_amount / wd.order_qty
        : null;

      const order_amount_pct = prevMetrics && prevMetrics.order_amount > 0
        ? (wd.order_amount - prevMetrics.order_amount) / prevMetrics.order_amount
        : null;

      const buyout_amount_pct = prevMetrics && prevMetrics.buyout_amount > 0
        ? (wd.buyout_amount - prevMetrics.buyout_amount) / prevMetrics.buyout_amount
        : null;

      const avg_week_price_pct = prevMetrics?.avg_week_price != null && prevMetrics.avg_week_price > 0 && avg_week_price != null
        ? (avg_week_price - prevMetrics.avg_week_price) / prevMetrics.avg_week_price
        : null;

      weekMetrics.push({
        order_amount: wd.order_amount,
        order_qty: wd.order_qty,
        buyout_amount: wd.buyout_amount,
        buyout_qty: wd.buyout_qty,
        order_amount_pct,
        buyout_amount_pct,
        smile_stock,
        fbo_stock,
        avg_week_price,
        avg_week_price_pct
      });

      prevMetrics = { order_amount: wd.order_amount, buyout_amount: wd.buyout_amount, avg_week_price };
    }

    items.push({
      offer_id: offerId,
      parent_article: extractParentArticle(offerId),
      parent_name: '', // filled below after grouping
      subgroup: oneCData.subgroup || '',
      brand: oneCData.brand || '',
      group: oneCData.group || '',
      name: resolvedName,
      weeks: weekMetrics
    });
  }

  // Fill parent_name: first name in each parent_article group (sorted by offer_id)
  items.sort((a, b) => a.parent_article.localeCompare(b.parent_article) || a.offer_id.localeCompare(b.offer_id));

  const parentNames = {};
  items.forEach(item => {
    if (!parentNames[item.parent_article] && item.name) {
      parentNames[item.parent_article] = item.name;
    }
  });
  items.forEach(item => {
    item.parent_name = parentNames[item.parent_article] || item.parent_article;
  });

  // Keep only items with any sales or current FBO stock
  const activeItems = items.filter(item =>
    item.weeks.some(w => w.order_qty > 0) || (fboStockByOfferId[item.offer_id] || 0) > 0
  );

  console.log(`\nTotal Ozon API calls: ${ozon.getApiCallCount()}`);
  console.log(`Active items: ${activeItems.length}`);

  return { weeks, items: activeItems, fromDate, toDate };
}

async function weeklySalesReport(weeksCount = 13, endDate = null) {
  const data = await calculateWeeklySalesData(weeksCount, endDate);

  const now = new Date();
  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  const mon = getMonStr(now);
  const dateStr = formatDate(now);

  const outputDir = path.join(process.cwd(), 'reports', 'ozon', mon);
  await fs.mkdir(outputDir, { recursive: true });

  console.log('\nGenerating weekly sales report...');
  const buffer = await Excel.createOzonWeeklySalesReportBuffer(data);

  const fname = path.join(outputDir, `ozon_weekly_sales_${dateStr}_${hours}h${minutes}m_${weeksCount}weeks.xlsx`);
  await fs.writeFile(fname, buffer);
  console.log(`Saved: ${fname}`);
}

module.exports = { calculateWeeklySalesData, weeklySalesReport };

if (require.main === module) {
  const args = process.argv.slice(2);
  const weeksCount = args.length > 0 ? parseInt(args[0]) : 13;
  const endDate = args.length > 1 ? (() => {
    const d = new Date(args[1]);
    d.setHours(23, 59, 59, 999);
    return d;
  })() : null;

  weeklySalesReport(weeksCount, endDate)
    .then(() => {
      console.log('\n✓ Weekly sales report generation complete');
      process.exit(0);
    })
    .catch(error => {
      console.error('Error generating weekly sales report:', error);
      process.exit(1);
    });
}
