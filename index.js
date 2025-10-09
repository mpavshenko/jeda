const Ozon = require('./services/ozon');
const Excel = require('./services/excel');
const OneC = require('./services/1c');
const { on } = require('events');
const json = o => JSON.stringify(o, null, 2)
const ozon = new Ozon();
const oneC = new OneC();

function getDateRangeFromYesterday(days) {
  const toDate = new Date();
  toDate.setHours(23, 59, 59, 999);
  toDate.setDate(toDate.getDate() - 1); // Yesterday

  const fromDate = new Date(toDate);
  fromDate.setDate(fromDate.getDate() - days + 1);
  fromDate.setHours(0, 0, 0, 0);

  return { fromDate, toDate };
}

function formatDate(date) {
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const day = date.getDate().toString().padStart(2, '0');
  const month = months[date.getMonth()];
  return `${month}-${day}`;
}

function merge1CStock(ordersWithStocks, oneCStocks) {
  const stockByArticul = {};
  oneCStocks.forEach(item => {
    stockByArticul[item.Articul] = {
      price: parseFloat(item.Price.replace(',', '.')),
      amount: item.Amount
    };
  });

  ordersWithStocks.forEach(product => {
    const stock1C = stockByArticul[product.offer_id];
    if (stock1C) {
      product.price_1c = stock1C.price;
      product.amount_1c = stock1C.amount;
    } else {
      product.price_1c = null;
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
      const demandedStock = x.daily * stockCoverageDays - x.in_transit;
      const remainingStock = Math.max(0, x.stock - fulfillmentLeadTimeDays * x.daily);
      x.supply = Math.round(demandedStock - remainingStock);
    });
  });
}

async function calculateFulfillmentData(daysCovered = 28, stockCoverageDays = 28, fulfillmentLeadTimeDays = 14) {
  const { fromDate, toDate } = getDateRangeFromYesterday(daysCovered);

  console.log(`Analyzing period: ${fromDate.toISOString()} to ${toDate.toISOString()}`);
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
  calculateSupplyNeeds(ordersWithStocks, stockCoverageDays, fulfillmentLeadTimeDays);

  // 1C STOCK
  const oneCStocks = await oneC.getStock();
  console.log(`Found ${oneCStocks.length} products in 1C stock`);
  merge1CStock(ordersWithStocks, oneCStocks);

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

  const dateRange = `${formatDate(fromDate)}_${formatDate(toDate)}`;
  const outputDir = path.join(process.cwd(), dateRange);

  // Create directory if it doesn't exist
  await fs.mkdir(outputDir, { recursive: true });
  console.log(`Created directory: ${dateRange}/`);

  console.log('\nGenerating main supply report...');
  const mainBuffer = await Excel.createFulfillmentReportBuffer(ordersWithStocks);

  const fname = path.join(outputDir, `fulfillment_${dateRange}.xlsx`);
  await fs.writeFile(fname, mainBuffer);
  console.log(`Saved: ${fname}`);

  console.log('\nGenerating cluster supply reports...');
  for (const clusterName of clusterNames) {
    const clusterBuffer = await Excel.createClusterFulfillmentReportBuffer(clusterName, ordersWithStocks);
    if (clusterBuffer) {
      const fname = path.join(outputDir, `fulfillment_${clusterName}_${dateRange}.xlsx`);
      await fs.writeFile(fname, clusterBuffer);
      console.log(`Saved: ${fname}`);
    }
  }
}

async function main() {
  console.log("Starting...");

  await fulfillmentReport();
}

main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});

