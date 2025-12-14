require('dotenv').config();

const Ozon = require('./services/ozon');
const Excel = require('./services/excel');
const OneC = require('./services/1c');
const { getDateRangeFromYesterday, formatDate } = require('./utils/dates');

const ozon = new Ozon();
const oneC = new OneC();

function merge1CStock(products, oneCStocks) {
  const stockByArticul = {};
  oneCStocks.forEach(item => {
    stockByArticul[item.Articul] = {
      price: parseFloat(item.Price.replace(',', '.')),
      cost: item.CenaSeb && item.CenaSeb.trim() !== '' ? parseFloat(item.CenaSeb.replace(',', '.')) : null,
      amount: item.Amount,
      brand: item.Brand || '',
      group: item.Group || '',
      subgroup: item.Subgroup || ''
    };
  });

  products.forEach(product => {
    const stock1C = stockByArticul[product.offer_id];
    if (stock1C) {
      product.price_1c = stock1C.price;
      product.cost_1c = stock1C.cost;
      product.brand = stock1C.brand;
      product.group = stock1C.group;
      product.subgroup = stock1C.subgroup;
    } else {
      product.price_1c = null;
      product.cost_1c = null;
      product.brand = '';
      product.group = '';
      product.subgroup = '';
    }
  });
}

async function calculateManagementData(daysCovered = 28) {
  const { fromDate, toDate } = getDateRangeFromYesterday(daysCovered);

  console.log(`Analyzing period: ${fromDate.toISOString()} to ${toDate.toISOString()}`);
  console.log(`Local time: ${fromDate.toLocaleString()} to ${toDate.toLocaleString()}`);
  console.log(`Days covered: ${daysCovered}`);

  // Fetch FBO orders
  let fboOrders = await ozon.getAllFboOrders(fromDate.toISOString(), toDate.toISOString());
  console.log(`Found ${fboOrders.length} FBO orders`);

  // Flatten to products with cluster info
  const fboOrderedProducts = ozon.getFlattenedOrderedProducts(fboOrders);
  console.log(`Found ${fboOrderedProducts.length} FBO ordered products`);

  // Fetch cluster/warehouse mapping
  const clustersAndWarehouses = await ozon.getClustersAndWarehouses();
  const warehouseToClusterMap = ozon.createWarehouseToClusterMap(clustersAndWarehouses);

  // Add manual mappings for warehouses not in API response
  warehouseToClusterMap['МИНСК_МПСЦ'] = 'Беларусь';
  warehouseToClusterMap['АСТАНА_РФЦ'] = 'Казахстан';

  console.log(`Found ${clustersAndWarehouses.length} clusters`);

  // Fetch stocks
  const allStocks = await ozon.getAllStocks();
  console.log(`Found ${allStocks.length} stock entries`);

  // Aggregate stocks by product and cluster
  const stocksByCluster = ozon.calculateStocksByCluster(allStocks, warehouseToClusterMap);

  // Aggregate by product and cluster
  const productClusterMap = {};

  // Process orders
  fboOrderedProducts.forEach(item => {
    const offerId = item.offer_id;
    const cluster = item.cluster_to || 'Unknown';

    if (!productClusterMap[offerId]) {
      productClusterMap[offerId] = {
        offer_id: offerId,
        name: item.name,
        clusters: {}
      };
    }

    if (!productClusterMap[offerId].clusters[cluster]) {
      productClusterMap[offerId].clusters[cluster] = {
        cluster: cluster,
        fbo_ordered_count: 0,
        fbo_stock_count: 0
      };
    }

    productClusterMap[offerId].clusters[cluster].fbo_ordered_count += item.quantity;
  });

  // Process stocks
  Object.keys(stocksByCluster).forEach(itemCode => {
    const stockData = stocksByCluster[itemCode];

    if (!productClusterMap[itemCode]) {
      productClusterMap[itemCode] = {
        offer_id: itemCode,
        name: '',
        clusters: {}
      };
    }

    Object.keys(stockData.clusters).forEach(cluster => {
      if (!productClusterMap[itemCode].clusters[cluster]) {
        productClusterMap[itemCode].clusters[cluster] = {
          cluster: cluster,
          fbo_ordered_count: 0,
          fbo_stock_count: 0
        };
      }

      const clusterStock = stockData.clusters[cluster];
      const totalStock = (clusterStock.free_to_sell_amount || 0) +
        (clusterStock.reserved_amount || 0) +
        (clusterStock.promised_amount || 0);
      productClusterMap[itemCode].clusters[cluster].fbo_stock_count = totalStock;
    });
  });

  // Flatten to products with clusters
  const products = [];
  Object.values(productClusterMap).forEach(product => {
    Object.values(product.clusters).forEach(clusterData => {
      products.push({
        offer_id: product.offer_id,
        name: product.name,
        cluster: clusterData.cluster,
        fbo_ordered_count: clusterData.fbo_ordered_count,
        fbo_stock_count: clusterData.fbo_stock_count
      });
    });
  });

  console.log(`Aggregated into ${products.length} product-cluster combinations`);

  // Get all products for names
  const allProducts = await ozon.getAllProducts();
  console.log(`Found ${allProducts.length} products in catalog`);
  const offerIdToName = allProducts.reduce((map, p) => {
    map[p.offer_id] = p.name;
    return map;
  }, {});

  // Patch names
  products.forEach(product => {
    if (!product.name && offerIdToName[product.offer_id]) {
      product.name = offerIdToName[product.offer_id];
    }
  });

  // Merge with 1C to get Brand/Group/Subgroup
  const oneCStocks = await oneC.getStock();
  console.log(`Found ${oneCStocks.length} products in 1C stock`);
  merge1CStock(products, oneCStocks);

  // Print API call count
  console.log(`\nTotal Ozon API calls: ${ozon.getApiCallCount()}`);

  return {
    products,
    fromDate,
    toDate
  };
}

async function managementReport(daysCovered = 28) {
  const fs = require('fs').promises;
  const path = require('path');

  const {
    products,
    fromDate,
    toDate
  } = await calculateManagementData(daysCovered);

  const now = new Date();
  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  const dateRange = `${formatDate(fromDate)}_${formatDate(toDate)}`;

  const outputDir = path.join(process.cwd(), 'reports', 'ozon');

  // Create reports directory
  await fs.mkdir(outputDir, { recursive: true });
  console.log(`Created directory: reports/ozon/`);

  console.log('\nGenerating management hierarchy report...');
  const buffer = await Excel.createManagementHierarchyReportBuffer(products, daysCovered);

  const fname = path.join(outputDir, `ozon_management_${dateRange}.xlsx`);
  await fs.writeFile(fname, buffer);
  console.log(`Saved: ${fname}`);

  console.log('\n=== Report Summary ===');
  console.log(`Total products with FBO sales: ${products.length}`);
  console.log(`Total FBO units sold: ${products.reduce((sum, p) => sum + p.fbo_ordered_count, 0)}`);
  console.log(`Products with 1C hierarchy: ${products.filter(p => p.brand).length}`);
}

// Export functions for use in other modules or scheduled jobs
module.exports = {
  calculateManagementData,
  managementReport
};

// CLI execution
if (require.main === module) {
  const args = process.argv.slice(2);
  const daysCovered = args.length > 0 ? parseInt(args[0]) : 28;

  managementReport(daysCovered)
    .then(() => {
      console.log('\n✓ Management report generation complete');
      process.exit(0);
    })
    .catch(error => {
      console.error('Error generating management report:', error);
      process.exit(1);
    });
}
