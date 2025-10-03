const Ozon = require('./services/ozon');
const Excel = require('./services/excel');
const json = o => JSON.stringify(o, null, 2)
const ozon = new Ozon();

function calculateDateRange(daysCovered) {
  const toDate = new Date();
  toDate.setHours(23, 59, 59, 999);
  toDate.setDate(toDate.getDate() - 1); // Yesterday

  const fromDate = new Date(toDate);
  fromDate.setDate(fromDate.getDate() - daysCovered + 1);
  fromDate.setHours(0, 0, 0, 0);

  return { fromDate, toDate };
}

function formatDate(date) {
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const day = date.getDate().toString().padStart(2, '0');
  const month = months[date.getMonth()];
  return `${day}${month}`;
}

function calculateSupplyMetrics(ordersWithStocks) {
  const FBO_STOCK_SUPPLY_DAYS = 28;
  const FBO_SUPPLY_DAYS = 14;
  // const FBO_SAFETY_STOCK_DAYS = 5;

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
      const demandedStock = x.daily * FBO_STOCK_SUPPLY_DAYS - x.in_transit;
      const remainingStock = Math.max(0, x.stock - FBO_SUPPLY_DAYS * x.daily);
      x.supply = Math.round(demandedStock - remainingStock);
    });
  });
}

async function calculateSupply(daysCovered) {
  const { fromDate, toDate } = calculateDateRange(daysCovered);

  console.log(`Analyzing period: ${fromDate.toISOString()} to ${toDate.toISOString()}`);
  console.log(`Days covered: ${daysCovered}`);

  // FBO
  let fboOrders = await ozon.getAllFboOrders(fromDate.toISOString(), toDate.toISOString());
  console.log(`Found FBO ${fboOrders.length} orders`);
  orders = fboOrders.filter(o => o.status !== 'cancelled');
  console.log(`Found not cancelled ${fboOrders.length} FBO orders`);

  // FBS
  let fbsOrders = await ozon.getAllFbsOrders(fromDate.toISOString(), toDate.toISOString());
  console.log(`Found FBS ${fbsOrders.length} orders`);
  fbsOrders = fbsOrders.filter(o => o.status !== 'cancelled');
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
  calculateSupplyMetrics(ordersWithStocks);

  // EXPORT TO EXCEL
  const filename = `report_${formatDate(fromDate)}-${formatDate(toDate)}.xlsx`;
  await Excel.exportOrdersWithStocksToExcel(ordersWithStocks, filename);

  // Print API call count
  console.log(`\nTotal Ozon API calls: ${ozon.getApiCallCount()}`);
}

async function main() {
  console.log("Starting...");

  await calculateSupply(28);


  // const response = await ozon.getProducts(3);
  // console.log(json(response));


  //=================================== STOCKS
  // const products = await ozon.getAllProducts();
  // const nameByOfferId = ozon.createOfferIdToNameMap(products);
  // console.log(json(nameByOfferId));




  // const clusters = await ozon.getClustersAndWarehouses();
  // const w2c = ozon.createWarehouseToClusterMap(clusters);
  // console.log(json(w2c));

  // const allStocks = await ozon.getAllStocks();
  // const stocksByCluster = ozon.calculateStocksByCluster(allStocks, w2c);
  // console.log(json(stocksByCluster));

  // flatStocks = ozon.transformStocksByClusterToFlat(stocksByCluster, nameByOfferId);
  // console.log(flatStocks[0]);

  // Excel.exportToExcel(flatStocks, 'stocks_by_cluster.xlsx');
  // await Excel.exportToExcelWithHeatmap(flatStocks, 'stocks_by_cluster_heatmap.xlsx');

  //=================================== ORDERS

  // let orders = await ozon.getAllFboOrders('2025-06-01T00:00:00.000Z', '2025-08-31T23:59:59.000Z');
  // console.log(`Found ${orders.length} orders`);
  // orders = orders.filter(o => o.status == 'cancelled');
  // console.log(`Found not cancelled ${orders.length} orders`);
  // console.log(JSON.stringify(orders, null, 2));

  // if (orders.length > 0) {
  //   console.log(json(orders[0]));
  // }

  // const orderedProducts = ozon.getFlattenedOrderedProductsFunctional(orders);
  // console.log(json(orderedProducts[0]));
  // console.table(orderedProducts);

  // const orderedProductsByCluster = ozon.calculateProductQuantityByClusterFunctional(orderedProducts);
  // console.log(json(orderedProductsByCluster));
  // console.table(orderedProductsByCluster);

  // const orderedProductsByClusterFlat = ozon.calculateProductQuantityByClusterFlat(orderedProducts);
  // console.table(orderedProductsByClusterFlat);

  // Excel.exportToExcel(orderedProductsByClusterFlat, 'products_by_cluster.xlsx');
  // await Excel.exportToExcelWithHeatmap(orderedProductsByClusterFlat, 'products_by_cluster_heatmap.xlsx');


}



main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});

