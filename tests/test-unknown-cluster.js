require('dotenv').config();
const Ozon = require('../services/ozon');
const ozon = new Ozon();

(async () => {
  try {
    // Get last 7 days of orders
    const toDate = new Date();
    const fromDate = new Date(Date.now() - 7*24*60*60*1000);

    console.log('Fetching FBO orders...');
    const orders = await ozon.getAllFboOrders(fromDate.toISOString(), toDate.toISOString());
    const flattened = ozon.getFlattenedOrderedProducts(orders);

    console.log('\nSample orders with cluster_to:');
    flattened.slice(0, 10).forEach(p => {
      console.log(`  ${p.offer_id}: cluster_to = ${p.cluster_to || 'NULL'}`);
    });

    const withoutCluster = flattened.filter(p => !p.cluster_to);
    console.log(`\nOrders without cluster_to: ${withoutCluster.length} / ${flattened.length}`);

    // Check stocks
    console.log('\nFetching stocks and warehouse mapping...');
    const clustersAndWarehouses = await ozon.getClustersAndWarehouses();
    const warehouseToClusterMap = ozon.createWarehouseToClusterMap(clustersAndWarehouses);
    const stocks = await ozon.getAllStocks();

    // Find unmapped warehouses
    const uniqueWarehouses = [...new Set(stocks.map(s => s.warehouse_name))];
    const unmappedWarehouses = uniqueWarehouses.filter(w => !warehouseToClusterMap[w]);

    console.log(`\nTotal unique warehouses in stock data: ${uniqueWarehouses.length}`);
    console.log(`Unmapped warehouses: ${unmappedWarehouses.length}`);
    if (unmappedWarehouses.length > 0) {
      console.log('Unmapped warehouse names:');
      unmappedWarehouses.forEach(w => console.log(`  - ${w}`));
    }

    console.log(`\nTotal Ozon API calls: ${ozon.getApiCallCount()}`);
  } catch (error) {
    console.error('Error:', error);
  }
})();
