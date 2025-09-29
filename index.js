const Ozon = require('./services/ozon');
const Excel = require('./services/excel');
const json = o => JSON.stringify(o, null, 2)
const ozon = new Ozon();

async function calculateSupply(fromDate, toDate) {
  // ORDERS
  const daysCovered = ozon.calculateDaysCovered(fromDate, toDate);
  console.log(`Days covered: ${daysCovered}`);

  // FBO
  let fboOrders = await ozon.getAllFboOrders(fromDate, toDate);
  console.log(`Found FBO ${fboOrders.length} orders`);
  orders = fboOrders.filter(o => o.status !== 'cancelled');
  console.log(`Found not cancelled ${fboOrders.length} FBO orders`);

  // FBS
  let fbsOrders = await ozon.getAllFbsOrders(fromDate, toDate);
  console.log(`Found FBS ${fbsOrders.length} orders`);
  fbsOrders = fbsOrders.filter(o => o.status !== 'cancelled');
  console.log(`Found not cancelled ${fbsOrders.length} FBS orders`);

  const fboOrderedProducts = ozon.getFlattenedOrderedProducts(fboOrders);
  const fbsOrderedProductsFBS = ozon.getFlattenedOrderedProducts(fbsOrders);
  const orderedProductsByCluster = ozon.calculateProductQuantityByCluster(fboOrderedProducts, fbsOrderedProductsFBS, daysCovered);

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

  // EXPORT TO EXCEL
  await Excel.exportOrdersWithStocksToExcel(ordersWithStocks, 'fbs_fbo_orders_with_stocks_and_transit.xlsx');

  // Print API call count
  console.log(`\nTotal Ozon API calls: ${ozon.getApiCallCount()}`);
}

async function main() {
  console.log("Starting...");

  await calculateSupply('2025-09-01T00:00:00.000Z', '2025-09-29T23:59:59.000Z');


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

