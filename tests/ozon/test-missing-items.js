require('dotenv').config();

const Ozon = require('../../services/ozon');
const { getDateRangeFromYesterday } = require('../../utils/dates');

const ozon = new Ozon();

const MISSING_ARTICLES = [
  '01-517', '15G313', 'A301', 'AG2401', 'D81410-S', 'D81430-LD', 'D81430-S',
  'D81480-M', 'D81480-S', 'D81480-XXL', 'D81550-S', 'D81550-XL', 'D81600-M',
  'D81600-S', 'D81600-XL', 'D81600-XXL', 'D81601-M', 'D81601-XL', 'D81703-L',
  'D81703-M', 'D81703-XL', 'D81703-XXL', 'D81704-L', 'D81704-XL', 'D81704-XXL',
  'D81903', 'D81904', 'D81906', 'D82070-39', 'D82070-40', 'D82070-41',
  'D82070-42', 'D82070-43', 'D82070-44', 'D82070-46', 'D82070-47', 'D82090-40',
  'D82110-40', 'D82157-39', 'D82157-40', 'D82157-45', 'D82157-46', 'D82157-47',
  'D82300-40', 'D82300-41', 'D82300-42', 'D82300-44', 'D82-320', 'D82-321',
  'D83251-S', 'D83300-S', 'D83400-M', 'D83401-L', 'D83401-M', 'D83401-XL',
  'D83402-L', 'D83402-M', 'D83402-XL', 'D83403-M', 'D84101', 'D84102',
  'HY090101', 'HY090265', 'HYT24', 'HYT62', 'J70329', 'J72356', 'J72359',
  'J72388', 'J72985', 'J72986', 'J72990', 'J73176', 'J74044-5', 'RP17315',
  'RP7319', 'RP7336', 'RP7445', 'AG2403', 'D83300-L', 'D82200-47'
];

async function main() {
  const daysCovered = 28;
  const { fromDate, toDate } = getDateRangeFromYesterday(daysCovered);

  console.log(`Period: ${fromDate.toISOString()} to ${toDate.toISOString()}`);
  console.log(`Checking ${MISSING_ARTICLES.length} missing articles\n`);

  // 1. Fetch product catalog
  console.log('--- Fetching product catalog ---');
  const allProducts = await ozon.getAllProducts();
  console.log(`Catalog: ${allProducts.length} products`);
  const catalogSet = new Set(allProducts.map(p => p.offer_id));

  // 2. Fetch orders
  console.log('\n--- Fetching FBO orders ---');
  const fboOrders = await ozon.getAllFboOrders(fromDate.toISOString(), toDate.toISOString());
  console.log(`FBO orders: ${fboOrders.length}`);

  console.log('\n--- Fetching FBS orders ---');
  const fbsOrders = await ozon.getAllFbsOrders(fromDate.toISOString(), toDate.toISOString());
  console.log(`FBS orders: ${fbsOrders.length}`);

  const fboProducts = ozon.getFlattenedOrderedProducts(fboOrders);
  const fbsProducts = ozon.getFlattenedOrderedProducts(fbsOrders);

  const fboArticles = new Set(fboProducts.map(p => p.offer_id));
  const fbsArticles = new Set(fbsProducts.map(p => p.offer_id));

  // 3. Fetch stocks
  console.log('\n--- Fetching stocks ---');
  const allStocks = await ozon.getAllStocks();
  const clusters = await ozon.getClustersAndWarehouses();
  const w2c = ozon.createWarehouseToClusterMap(clusters);
  const stocksByCluster = ozon.calculateStocksByCluster(allStocks, w2c);
  console.log(`Stocks: ${Object.keys(stocksByCluster).length} unique articles`);

  // 4. Fetch in-transit
  console.log('\n--- Fetching in-transit ---');
  const supplyOrders = await ozon.getAllSupplyOrders();
  const bundleItems = await ozon.getAllBundleItems(supplyOrders);
  const inTransitByCluster = ozon.calculateInTransitByCluster(bundleItems, w2c);
  console.log(`In-transit: ${Object.keys(inTransitByCluster).length} unique articles`);

  // 5. Run merge (current logic)
  const orderedProductsByCluster = ozon.calculateProductQuantityByCluster(fboProducts, fbsProducts, daysCovered);
  const merged = ozon.mergeOrdersWithStocks(orderedProductsByCluster, stocksByCluster, inTransitByCluster);
  const mergedSet = new Set(merged.map(p => p.offer_id));

  // 6. Report per missing article
  console.log('\n========== DIAGNOSTIC RESULTS ==========\n');

  const categories = {
    stockOnly: [],
    inTransitOnly: [],
    notInCatalog: [],
    inMerged: [],
    nowhere: [],
    hasOrders: [],
  };

  for (const article of MISSING_ARTICLES) {
    const inCatalog = catalogSet.has(article);
    const inFbo = fboArticles.has(article);
    const inFbs = fbsArticles.has(article);
    const inStock = !!stocksByCluster[article];
    const inTransit = !!inTransitByCluster[article];
    const inReport = mergedSet.has(article);

    const stockInfo = inStock
      ? Object.entries(stocksByCluster[article].clusters)
          .map(([c, v]) => `${c}:${v.free_to_sell_amount}`)
          .join(', ')
      : '-';

    const transitInfo = inTransit
      ? Object.entries(inTransitByCluster[article])
          .map(([c, q]) => `${c}:${q}`)
          .join(', ')
      : '-';

    console.log(`${article}`);
    console.log(`  catalog=${inCatalog} fbo=${inFbo} fbs=${inFbs} stock=${inStock} transit=${inTransit} inReport=${inReport}`);
    if (inStock) console.log(`  stock: ${stockInfo}`);
    if (inTransit) console.log(`  transit: ${transitInfo}`);

    if (inReport) {
      categories.inMerged.push(article);
    } else if (!inCatalog) {
      categories.notInCatalog.push(article);
    } else if (inFbo || inFbs) {
      categories.hasOrders.push(article);
    } else if (inStock && !inTransit) {
      categories.stockOnly.push(article);
    } else if (inTransit) {
      categories.inTransitOnly.push(article);
    } else {
      categories.nowhere.push(article);
    }
  }

  console.log('\n========== SUMMARY ==========\n');
  console.log(`Total missing articles checked: ${MISSING_ARTICLES.length}`);
  console.log(`Already in report (false alarm):  ${categories.inMerged.length}`);
  console.log(`Stock only (ROOT CAUSE):          ${categories.stockOnly.length} <- mergeOrdersWithStocks gap`);
  console.log(`In-transit only:                  ${categories.inTransitOnly.length}`);
  console.log(`Has orders (unexpected):          ${categories.hasOrders.length}`);
  console.log(`Not in Ozon catalog at all:       ${categories.notInCatalog.length}`);
  console.log(`No data anywhere:                 ${categories.nowhere.length}`);

  if (categories.stockOnly.length > 0) {
    console.log(`\nStock-only articles: ${categories.stockOnly.join(', ')}`);
  }
  if (categories.notInCatalog.length > 0) {
    console.log(`\nNot in catalog: ${categories.notInCatalog.join(', ')}`);
  }
  if (categories.nowhere.length > 0) {
    console.log(`\nNo data anywhere: ${categories.nowhere.join(', ')}`);
  }
  if (categories.inMerged.length > 0) {
    console.log(`\nAlready in report: ${categories.inMerged.join(', ')}`);
  }

  console.log(`\nTotal Ozon API calls: ${ozon.getApiCallCount()}`);
}

main().catch(err => {
  console.error('Error:', err.message || err);
  process.exit(1);
});
