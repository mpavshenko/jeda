require('dotenv').config();

const WB = require('./services/wb');
const Excel = require('./services/excel');
const OneC = require('./services/1c');
const { getDateRangeFromYesterday, formatDate } = require('./utils/dates');

const wb = new WB();
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

  // Fetch all orders from statistics API
  const allOrders = await wb.getAllOrders(fromDate, toDate);
  console.log(`Found ${allOrders.length} total orders`);

  // Filter out cancelled orders
  const orders = allOrders.filter(order => !order.isCancel);
  console.log(`Found ${orders.length} non-cancelled orders`);

  // Enrich orders with cluster information
  const ordersWithClusters = wb.enrichOrdersWithClusters(orders);

  // Filter to only WB warehouse orders (equivalent to Ozon FBO)
  const wbWarehouseOrders = ordersWithClusters.filter(order => order.warehouseType === 'Склад WB');
  console.log(`Found ${wbWarehouseOrders.length} WB warehouse orders`);

  // Aggregate by product and cluster
  const productClusterMap = {};

  // Process orders
  wbWarehouseOrders.forEach(order => {
    // Construct article (same logic as in ffl-wb.js)
    const article = order.techSize && order.techSize !== '0'
      ? `${order.supplierArticle}-${order.techSize}`
      : order.supplierArticle;
    const cluster = order.cluster || 'Unknown';

    if (!productClusterMap[article]) {
      productClusterMap[article] = {
        offer_id: article,
        name: '',
        clusters: {}
      };
    }

    if (!productClusterMap[article].clusters[cluster]) {
      productClusterMap[article].clusters[cluster] = {
        cluster: cluster,
        fbo_ordered_count: 0,
        fbo_stock_count: 0
      };
    }

    productClusterMap[article].clusters[cluster].fbo_ordered_count += 1;
  });

  // Fetch stocks from statistics API
  const allStocks = await wb.getStocks();
  console.log(`Found ${allStocks.length} stock entries`);

  // Get warehouse to cluster mapping
  const warehouseToCluster = wb.createWarehouseToClusterMap();

  // Process stocks - aggregate by article and cluster
  allStocks.forEach(stock => {
    const article = stock.techSize && stock.techSize !== '0'
      ? `${stock.supplierArticle}-${stock.techSize}`
      : stock.supplierArticle;
    const cluster = warehouseToCluster[stock.warehouseName] || 'Unknown';

    if (!productClusterMap[article]) {
      productClusterMap[article] = {
        offer_id: article,
        name: '',
        clusters: {}
      };
    }

    if (!productClusterMap[article].clusters[cluster]) {
      productClusterMap[article].clusters[cluster] = {
        cluster: cluster,
        fbo_ordered_count: 0,
        fbo_stock_count: 0
      };
    }

    // Add stock quantity to cluster
    productClusterMap[article].clusters[cluster].fbo_stock_count += stock.quantity || 0;
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

  // Get all product cards for names
  const allCards = await wb.getAllCards();
  console.log(`Found ${allCards.length} product cards in catalog`);

  // Extract products from cards (with article codes)
  const catalogProducts = wb.extractProductsFromCards(allCards);
  const articleToName = catalogProducts.reduce((map, p) => {
    map[p.article] = p.name;
    return map;
  }, {});

  // Patch names
  products.forEach(product => {
    if (!product.name && articleToName[product.offer_id]) {
      product.name = articleToName[product.offer_id];
    }
  });

  // Merge with 1C to get Brand/Group/Subgroup
  const oneCStocks = await oneC.getStock();
  console.log(`Found ${oneCStocks.length} products in 1C stock`);
  merge1CStock(products, oneCStocks);

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

  const outputDir = path.join(process.cwd(), 'reports', 'wb');

  // Create reports directory
  await fs.mkdir(outputDir, { recursive: true });
  console.log(`Created directory: reports/wb/`);

  console.log('\nGenerating WB management hierarchy report...');
  const buffer = await Excel.createManagementHierarchyReportBuffer(products, daysCovered);

  const fname = path.join(outputDir, `wb_management_${dateRange}.xlsx`);
  await fs.writeFile(fname, buffer);
  console.log(`Saved: ${fname}`);

  console.log('\n=== Report Summary ===');
  console.log(`Total products with WB warehouse sales: ${products.length}`);
  console.log(`Total WB warehouse units sold: ${products.reduce((sum, p) => sum + p.fbo_ordered_count, 0)}`);
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
      console.log('\n✓ WB management report generation complete');
      process.exit(0);
    })
    .catch(error => {
      console.error('Error generating WB management report:', error);
      process.exit(1);
    });
}
