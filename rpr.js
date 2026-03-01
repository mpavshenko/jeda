require('dotenv').config();

const fs = require('fs');
const ExcelJS = require('exceljs');
const Ozon = require('./services/ozon');
const OneC = require('./services/1c');

const ozon = new Ozon();
const oneC = new OneC();

/*
Product spec - all src data required for price calculations and repricing:

product = {
  product_id,
  offer_id,
  name,
  height,
  depth,
  width,
  volume_litres,
  fbo_logistics_price,
  fbs_logistics_price,
  logistics_price,
  sales_percent_fbo,
  fbs_direct_flow_trans_max_amount,
  stock_fbo,
  stock_fbs,
  purchase_price // = CenaSeb from 1C
  recommended_price // = CenaRRC from 1C
  ozon_marketing_seller_price // = marketing_seller_price from getProductPrices
  ozon_price // = price from getProductPrices
  ozon_marketing_action_title // = title of marketing action which cause marketing_seller_price
}
*/

/*
price_branch_1= 
  (purchase_price + logistics_price + defect_costs) / 
  (1 – profit*(0.20 - change) - acquiring - ad_spending_rate - sales_percent_fbs)
*/
const ACQUIRING = 0.02;
const DEFECT_RATE = 0.04;
const PROFIT_MARGIN = 0.33;
const MIN_PROFIT = 50;
const AD_SPENDING_RATE = 0.1;

function calcPriceBranch1(product) {
  const defect_costs = product.purchase_price * DEFECT_RATE;
  const profit = Math.max(product.purchase_price * PROFIT_MARGIN, MIN_PROFIT);

  product.price_branch_1 = Math.round((product.purchase_price + product.logistics_price + defect_costs + profit)
    / (1 - ACQUIRING - AD_SPENDING_RATE - product.sales_percent_fbo / 100));
}

function calcVolumeInLitres({ height, depth, width }) {
  // dimensions come in mm, convert to litres (1 litre = 1,000,000 mm³)
  if (!height || !depth || !width) return 0;
  return (height * depth * width) / 1_000_000;
}

/*
spec:
до 1 литра включительно — 46,77 ₽;
от 1,001 до 2 литров включительно — 56,94 ₽;
от 2,001 до 3 литров включительно — 67,11 ₽;
от 3,001 до 190 литров включительно — 15,25 ₽ за каждый дополнительный литр свыше 3 литров;
от 190,001 до 1000 литров включительно — 6,1 ₽ за каждый дополнительный литр свыше 190 литров;
свыше 1000 литров — фиксированная стоимость 7859,86 ₽

С учетом текущего среднего времени доставки logistics_fbo надо умножить на 1,16 + и прибавить «доставку до места выдачи» 25 рублей.
*/
function calcFboLogisticPrice(volumeInLitres) {
  if (!volumeInLitres) return 0;
  let base;
  if (volumeInLitres <= 1) base = 46.77;
  else if (volumeInLitres <= 2) base = 56.94;
  else if (volumeInLitres <= 3) base = 67.11;
  else if (volumeInLitres <= 190) base = 67.11 + (volumeInLitres - 3) * 15.25;
  else if (volumeInLitres <= 1000) base = 67.11 + 187 * 15.25 + (volumeInLitres - 190) * 6.1;
  else base = 7859.86;
  return base * 1.32;
}

const COLUMNS = [
  { key: 'product_id', en: 'product_id', ru: 'ID товара' },
  { key: 'offer_id', en: 'offer_id', ru: 'Артикул' },
  { key: 'name', en: 'name', ru: 'Название' },
  { key: 'height', en: 'height', ru: 'Высота' },
  { key: 'depth', en: 'depth', ru: 'Глубина' },
  { key: 'width', en: 'width', ru: 'Ширина' },
  { key: 'volume_litres', en: 'volume_litres', ru: 'Объём, л' },
  { key: 'fbo_logistics_price', en: 'fbo_logistics_price', ru: 'Логистика FBO' },
  { key: 'fbs_logistics_price', en: 'fbs_logistics_price', ru: 'Логистика FBS' },
  { key: 'logistics_price', en: 'logistics_price', ru: 'Логистика' },
  { key: 'sales_percent_fbo', en: 'sales_percent_fbo', ru: 'Комиссия FBO, %' },
  { key: 'fbs_direct_flow_trans_max_amount', en: 'fbs_direct_flow_trans_max_amount', ru: 'Макс логистика FBS' },
  { key: 'stock_fbo', en: 'stock_fbo', ru: 'Остаток FBO' },
  { key: 'stock_fbs', en: 'stock_fbs', ru: 'Остаток FBS' },
  { key: 'purchase_price', en: 'purchase_price', ru: 'Себестоимость' },
  { key: 'recommended_price', en: 'recommended_price', ru: 'РРЦ' },
  { key: 'ozon_price', en: 'ozon_price', ru: 'Цена Ozon' },
  { key: 'ozon_marketing_seller_price', en: 'ozon_marketing_seller_price', ru: 'Цена с акцией' },
  { key: 'ozon_marketing_action_title', en: 'ozon_marketing_action_title', ru: 'Акция' },
  { key: 'price_branch_1', en: 'price_branch_1', ru: 'Расчёт цены #1' },
];

async function exportToExcel(products, filename = 'repricing-data.xlsx') {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Repricing');

  ws.addRow(COLUMNS.map(c => c.en));
  ws.addRow(COLUMNS.map(c => c.ru));

  const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDDDDD' } };
  [1, 2].forEach(rowNum => {
    const row = ws.getRow(rowNum);
    row.font = { bold: true };
    row.alignment = { horizontal: 'center' };
    row.eachCell(cell => { cell.fill = headerFill; });
  });
  ws.views = [{ state: 'frozen', ySplit: 2 }];

  const redFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFCCCC' } };
  products.forEach(p => {
    const row = ws.addRow(COLUMNS.map(c => p[c.key] ?? ''));
    if (p.ozon_marketing_seller_price && p.price_branch_1 && p.ozon_marketing_seller_price < p.price_branch_1) {
      row.eachCell(cell => { cell.fill = redFill; });
    }
  });

  COLUMNS.forEach((c, i) => {
    ws.getColumn(i + 1).width = Math.max(c.ru.length, c.en.length) + 2;
  });

  await workbook.xlsx.writeFile(filename);
  console.log(`Saved ${products.length} products to ${filename}`);
}

/*
  Data preparation steps:
  1) Get all products
  2) Enrich with height, depth, width from details API
  3) Enrich with sales_percent_fbo from prices API
  4) Enrich with purchase and recommended prices from 1C
  5) Enrich with total FBO stocks
*/

async function main() {
  console.log("Starting repricing data preparation...\n");

  // Step 1: Get all products
  console.log("--- Step 1: Getting all products ---");
  const { result } = await ozon.getProducts(1000);
  const products = result.items.map(p => ({ product_id: p.product_id, offer_id: p.offer_id }));
  console.log(`Got ${products.length} of ${result.total} products\n`);
  fs.writeFileSync('products.json', JSON.stringify(products, null, 2));
  const ids = products.map(p => p.product_id);

  // Build products map by product_id for enrichment
  const productsMap = products.reduce((acc, p) => { acc[p.product_id] = p; return acc; }, {});

  // Step 2: Enrich with height, depth, width from details API
  console.log("--- Step 2: Enriching with dimensions ---");
  const details = await ozon.getProductDetails(ids);
  details.result.forEach(d => {
    const p = productsMap[d.id];
    if (p) {
      p.name = d.name;
      p.height = d.height;
      p.depth = d.depth;
      p.width = d.width;
    }
  });
  console.log(`Enriched ${details.result.length} products with dimensions\n`);

  // Step 3: Enrich with sales_percent_fbo from prices API
  console.log("--- Step 3: Enriching with commissions ---");
  const prices = await ozon.getProductPrices(ids);
  fs.writeFileSync('prices.json', JSON.stringify(prices, null, 2));
  prices.items.forEach(pr => {
    const p = productsMap[pr.product_id];
    if (p) {
      p.sales_percent_fbo = pr.commissions?.sales_percent_fbo;
      p.fbs_direct_flow_trans_max_amount = pr.commissions?.fbs_direct_flow_trans_max_amount;
      p.ozon_price = pr.price?.price;
      p.ozon_marketing_seller_price = pr.price?.marketing_seller_price;
      const matchingAction = pr.marketing_actions?.actions?.find(a => a.value === pr.price?.marketing_seller_price);
      p.ozon_marketing_action_title = matchingAction?.title || null;
    }
  });
  console.log(`Enriched ${prices.items.length} products with commissions\n`);

  // Step 4: Enrich with purchase and recommended prices from 1C
  console.log("--- Step 4: Enriching with 1C data ---");
  const stock1c = await oneC.getStock();
  const stock1cMap = stock1c.reduce((acc, s) => { acc[s.Articul] = s; return acc; }, {});
  let matched1c = 0;
  products.forEach(p => {
    const s = stock1cMap[p.offer_id];
    if (s) {
      p.purchase_price = s.CenaSeb && s.CenaSeb.trim() !== ''
        ? parseFloat(s.CenaSeb.replace(',', '.'))
        : 0;
      p.recommended_price = s.CenaRRC && s.CenaRRC.trim() !== ''
        ? parseFloat(s.CenaRRC.replace(',', '.'))
        : 0;
      p.stock_fbs = s.Amount || 0;
      matched1c++;
    } else {
      p.purchase_price = 0;
      p.recommended_price = 0;
      p.stock_fbs = 0;
    }
  });
  console.log(`Matched ${matched1c}/${products.length} products with 1C data\n`);

  // Step 5: Enrich with total FBO stocks
  console.log("--- Step 5: Enriching with stocks ---");
  const stocks = await ozon.getAllStocks();
  // Aggregate total stock per offer_id
  const stockTotals = {};
  stocks.forEach(s => {
    if (!stockTotals[s.item_code]) {
      stockTotals[s.item_code] = 0;
    }
    stockTotals[s.item_code] += s.free_to_sell_amount || 0;
  });
  products.forEach(p => {
    p.stock_fbo = stockTotals[p.offer_id] || 0;
  });
  console.log(`Enriched products with FBO stock data\n`);

  // Final calculation
  // Calculate volume, logistics prices, and choose logistics model
  products.forEach(p => {
    p.volume_litres = calcVolumeInLitres(p);
    p.fbo_logistics_price = calcFboLogisticPrice(p.volume_litres);
    p.fbs_logistics_price = p.fbs_direct_flow_trans_max_amount + 0; // TODO: 
    p.logistics_price = p.stock_fbo > 0
      ? p.fbo_logistics_price
      : p.fbs_logistics_price;
    calcPriceBranch1(p);
  });

  // Save results
  // fs.writeFileSync('repricing-data.json', JSON.stringify(products, null, 2));
  console.log(`Saved ${products.length} products to repricing-data.json`);
  await exportToExcel(products);
}

// Only run main if this file is executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('Unhandled error:', error.message || error);
    process.exit(1);
  });
}
