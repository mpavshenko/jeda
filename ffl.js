require('dotenv').config();

const Ozon = require('./services/ozon');
const Excel = require('./services/excel');
const OneC = require('./services/1c');
const { getDateRangeFromYesterday, formatDate } = require('./utils/dates');

const ozon = new Ozon();
const oneC = new OneC();

function merge1CStock(ordersWithStocks, oneCStocks) {
  const stockByArticul = {};
  oneCStocks.forEach(item => {
    stockByArticul[item.Articul] = {
      price: parseFloat(item.Price.replace(',', '.')),
      cost: item.CenaSeb && item.CenaSeb.trim() !== '' ? parseFloat(item.CenaSeb.replace(',', '.')) : null,
      amount: item.Amount
    };
  });

  ordersWithStocks.forEach(product => {
    const stock1C = stockByArticul[product.offer_id];
    if (stock1C) {
      product.price_1c = stock1C.price;
      product.cost_1c = stock1C.cost;
      product.amount_1c = stock1C.amount;
    } else {
      product.price_1c = null;
      product.cost_1c = null;
      product.amount_1c = null;
    }
  });
}

function calculateSupplyNeeds(ordersWithStocks, stockCoverageDays, fulfillmentLeadTimeDays) {
  ordersWithStocks.forEach(product => {
    /*
      {
        "fboTotal": 0,
        "fbsTotal": 1,
        "total": 1,
        "daily": 0.03225806451612903,
        "stock": 2,
        "in_transit": 0
      }
    */
    Object.values(product.clusters).forEach(x => {
      // TODO
      // If 1C stock is 2 or less, reserve for Yandex - don't supply to Ozon
      // if (product.amount_1c !== null && product.amount_1c <= 2) {
      //   x.supply = 0;
      //   return;
      // }

      const demandedStock = x.daily * stockCoverageDays - x.in_transit;
      const remainingStock = Math.max(0, x.stock - fulfillmentLeadTimeDays * x.daily);
      x.supply = Math.round(demandedStock - remainingStock);
    });
  });
}

async function calculateFulfillmentData(daysCovered = 28, stockCoverageDays = 28, fulfillmentLeadTimeDays = 14) {
  const { fromDate, toDate } = getDateRangeFromYesterday(daysCovered);

  console.log(`Analyzing period: ${fromDate.toISOString()} to ${toDate.toISOString()}`);
  console.log(`Local time: ${fromDate.toLocaleString()} to ${toDate.toLocaleString()}`);
  console.log(`Days covered: ${daysCovered}`);

  // FBO
  let fboOrders = await ozon.getAllFboOrders(fromDate.toISOString(), toDate.toISOString());
  console.log(`Found FBO ${fboOrders.length} orders`);
  // fboOrders = fboOrders.filter(o => o.status !== 'cancelled');
  console.log(`Found not cancelled ${fboOrders.length} FBO orders`);

  // FBS
  let fbsOrders = await ozon.getAllFbsOrders(fromDate.toISOString(), toDate.toISOString());
  console.log(`Found FBS ${fbsOrders.length} orders`);
  // fbsOrders = fbsOrders.filter(o => o.status !== 'cancelled');
  console.log(`Found not cancelled ${fbsOrders.length} FBS orders`);

  const fboOrderedProducts = ozon.getFlattenedOrderedProducts(fboOrders);
  const fbsOrderedProducts = ozon.getFlattenedOrderedProducts(fbsOrders);
  const orderedProductsByCluster = ozon.calculateProductQuantityByCluster(fboOrderedProducts, fbsOrderedProducts, daysCovered);

  // WH
  const clusters = await ozon.getClustersAndWarehouses();
  const w2c = ozon.createWarehouseToClusterMap(clusters);

  // STOCKS
  const allStocks = await ozon.getAllStocks();
  const stocksByCluster = ozon.calculateStocksByCluster(allStocks, w2c);

  // IN-TRANSIT
  const supplyOrders = await ozon.getAllSupplyOrders();
  const bundleItems = await ozon.getAllBundleItems(supplyOrders);
  const inTransitByCluster = ozon.calculateInTransitByCluster(bundleItems, w2c);

  // MERGE
  const ordersWithStocks = ozon.mergeOrdersWithStocks(orderedProductsByCluster, stocksByCluster, inTransitByCluster);

  // GET ALL PRODUCTS FOR NAMES
  const allProducts = await ozon.getAllProducts();
  console.log(`Found ${allProducts.length} products`);
  const offerIdToName = allProducts.reduce((map, p) => {
    map[p.offer_id] = p.name;
    return map;
  }, {});

  // PATCH NULL NAMES (for those which only in transit and have no orders)
  ordersWithStocks.forEach(product => {
    if (!product.name && offerIdToName[product.offer_id]) {
      product.name = offerIdToName[product.offer_id];
    }
  });

  // 1C STOCK (moved before supply calculation to check 1C stock)
  const oneCStocks = await oneC.getStock();
  console.log(`Found ${oneCStocks.length} products in 1C stock`);
  merge1CStock(ordersWithStocks, oneCStocks);

  // Calculate supply needs (now has access to amount_1c)
  calculateSupplyNeeds(ordersWithStocks, stockCoverageDays, fulfillmentLeadTimeDays);

  // Print API call count
  console.log(`\nTotal Ozon API calls: ${ozon.getApiCallCount()}`);

  return {
    ordersWithStocks,
    clusterNames: clusters.map(c => c.cluster_name),
    fromDate,
    toDate
  };
}

async function fulfillmentReport(daysCovered = 28, stockCoverageDays = 28, fulfillmentLeadTimeDays = 14) {
  const fs = require('fs').promises;
  const path = require('path');

  const {
    ordersWithStocks,
    clusterNames,
    fromDate,
    toDate
  } = await calculateFulfillmentData(daysCovered, stockCoverageDays, fulfillmentLeadTimeDays);

  const now = new Date();
  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  const dateRange = `${formatDate(fromDate)}_${formatDate(toDate)}`;
  const folderName = `${dateRange}_${hours}-${minutes}`;

  const reportsBaseDir = path.join(process.cwd(), 'reports', 'ozon');
  const outputDir = path.join(reportsBaseDir, folderName);

  // Create reports base directory and date-specific directory
  await fs.mkdir(outputDir, { recursive: true });
  console.log(`Created directory: reports/ozon/${folderName}/`);

  console.log('\nGenerating main supply report...');
  const mainBuffer = await Excel.createFulfillmentReportBuffer(ordersWithStocks);

  const fname = path.join(outputDir, `ozon_fulfillment_${dateRange}.xlsx`);
  await fs.writeFile(fname, mainBuffer);
  console.log(`Saved: ${fname}`);

  console.log('\nGenerating cluster supply reports...');
  for (const clusterName of clusterNames) {
    const clusterBuffer = await Excel.createClusterFulfillmentReportBuffer(clusterName, ordersWithStocks);
    if (clusterBuffer) {
      const fname = path.join(outputDir, `ozon_fulfillment_${clusterName}_${dateRange}.xlsx`);
      await fs.writeFile(fname, clusterBuffer);
      console.log(`Saved: ${fname}`);
    }
  }

  console.log('\nGenerating cost summary report...');
  const costBuffer = await Excel.createCostSummaryReportBuffer(ordersWithStocks);
  const generationDate = `${formatDate(toDate)}_${hours}-${minutes}`;
  const costFilename = path.join(outputDir, `ozon_cost_summary_${generationDate}.xlsx`);
  await fs.writeFile(costFilename, costBuffer);
  console.log(`Saved: ${costFilename}`);
}

async function main() {
  console.log("Starting fulfillment calculation script...");

  await fulfillmentReport(28, 45);
}

// Only run main if this file is executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('Unhandled error:', error.message || error);
    process.exit(1);
  });
}

module.exports = {
  fulfillmentReport
};

