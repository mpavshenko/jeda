require('dotenv').config();

const WB = require('./services/wb');
const OneC = require('./services/1c');
const { getDateRangeFromYesterday, formatDate } = require('./utils/dates');
const { wbConfig } = require('./config');
const wb = new WB();
const oneC = new OneC();
const Excel = require('./services/excel');

const CLUSTER_NAMES = Object.keys(wbConfig.clusters);


/* Initialize fulfillment collection with product data
   Input: fulfillment array and products from extractProductsFromCards
   Output: mutates fulfillment array to add products with all clusters initialized to zero

   Example input products:
   [{ article: 'D81140-L', name: 'Полукомбинезон рабочий DOWELL White HD' }]

   Example output fulfillment:
   [{
     article: 'D81140-L',
     name: 'Полукомбинезон рабочий DOWELL White HD',
     clusters: {
       'Центральный': { fbo_total: 0, fbs_total: 0, total: 0, daily: 0, stock: 0, in_transit: 0, supply_need: 0 },
       'Приволжский': { fbo_total: 0, fbs_total: 0, total: 0, daily: 0, stock: 0, in_transit: 0, supply_need: 0 },
       // ... all other clusters
     }
   }]
*/
function addProducts(fulfillment, products) {
  const { wbConfig } = require('./config');
  const clusterNames = Object.keys(wbConfig.clusters);

  products.forEach(product => {
    const clusters = {};

    // Initialize all clusters with zero values
    clusterNames.forEach(clusterName => {
      clusters[clusterName] = {
        fbo_total: 0,
        fbs_total: 0,
        total: 0,
        daily: 0,
        stock: 0,
        in_transit: 0,
        supply_need: 0
      };
    });

    fulfillment.push({
      article: product.article,
      name: product.name,
      barcode: product.barcode,
      clusters
    });
  });
}

/* Aggregate orders by products and clusters
   Input: fulfillment array (initialized with products) and orders with cluster data
   Output: mutates fulfillment array to add order totals for each cluster

   Example input orders:
   [{
     date: '2025-09-23T22:07:10',
     warehouseName: 'Тула',
     warehouseType: 'Склад WB',
     supplierArticle: 'D81250',
     techSize: 'XL',
     isCancel: false,
     cluster: 'Центральный'
   }]

   Example output fulfillment:
   [{
     article: 'D81250-XL',
     name: 'Product name',
     clusters: {
       'Центральный': {
         fbo_total: 1,  // 'Склад WB'
         fbs_total: 0,  // 'Склад продавца'
         total: 1,
         daily: 0.036
       }
     }
   }]
*/
function aggregateOrdersByProductsAndClusters(fulfillment, ordersWithClusters, daysCovered) {
  // Create a map for quick product lookup by article
  const productMap = new Map();
  fulfillment.forEach(product => {
    productMap.set(product.article, product);
  });

  // Debug: Track unmapped warehouses
  const unmappedWarehouses = new Set();

  // Aggregate orders
  ordersWithClusters.forEach(order => {
    // Build article from supplierArticle and techSize
    // Skip techSize if it's:
    // - '0' (default/universal)
    // - 'универсальный' (universal/one-size)
    // - shoe size pattern like '40-41', '46-47', '44-45' (treated as single SKU)
    const isShoeSize = order.techSize && /^\d{2}-\d{2}$/.test(order.techSize);
    const shouldSkipSize = !order.techSize ||
      order.techSize === '0' ||
      order.techSize === 'универсальный' ||
      isShoeSize;

    const article = shouldSkipSize
      ? order.supplierArticle
      : `${order.supplierArticle}-${order.techSize}`;

    // Include all orders (both placed and purchased) for better demand forecasting
    // Cancelled orders still represent market demand and help with supply planning
    // if (order.isCancel) {
    //   return;
    // }

    const cluster = order.cluster || 'Unknown';
    const product = productMap.get(article);

    if (!product) {
      // Product not found in catalog - skip or warn
      return;
    }

    // Check if cluster exists in product
    if (!product.clusters[cluster]) {
      unmappedWarehouses.add(order.warehouseName);
      return;
    }

    // Increment counters based on warehouse type (cluster already initialized)
    if (order.warehouseType === 'Склад WB') {
      product.clusters[cluster].fbo_total++;
    } else if (order.warehouseType === 'Склад продавца') {
      product.clusters[cluster].fbs_total++;
    }
  });

  // Calculate totals and daily averages
  fulfillment.forEach(product => {
    Object.values(product.clusters).forEach(cluster => {
      cluster.total = cluster.fbo_total + cluster.fbs_total;
      cluster.daily = cluster.total / daysCovered;
    });
  });

  // Debug output
  if (unmappedWarehouses.size > 0) {
    console.log(`\n=== Unmapped Warehouses in Orders (${unmappedWarehouses.size}) ===`);
    console.log(`The following warehouses are not in wbConfig.clusters:`);
    Array.from(unmappedWarehouses).sort().forEach(warehouse => console.log(`  - "${warehouse}"`));
  }
}

/* Merge 1C stock data into fulfillment collection
   Input: fulfillment array and 1C stock data
   Output: mutates fulfillment array to add price_1c and amount_1c fields

   Example input 1C stocks:
   [{
     Articul: 'D81250',
     Name: 'Куртка рабочая',
     Price: '1234,56',
     Amount: 100
   }]

   Example output fulfillment:
   [{
     article: 'D81250-XL',
     name: 'Куртка рабочая 3 в 1',
     price_1c: 1234.56,
     amount_1c: 100,
     clusters: { ... }
   }]
*/
function merge1CStock(fulfillment, oneCStocks) {
  const stockByArticul = {};
  oneCStocks.forEach(item => {
    stockByArticul[item.Articul] = {
      price: parseFloat(item.Price.replace(',', '.')),
      amount: item.Amount
    };
  });

  fulfillment.forEach(product => {
    // Try to match by base article (without size suffix)
    const baseArticle = product.article.split('-')[0];
    const stock1C = stockByArticul[product.article] || stockByArticul[baseArticle];

    if (stock1C) {
      product.price_1c = stock1C.price;
      product.amount_1c = stock1C.amount;
    } else {
      product.price_1c = null;
      product.amount_1c = null;
    }
  });
}

/* Add stock and in-transit data to fulfillment collection
   Input: fulfillment array (with products and orders) and stocks from getStocks()
   Output: mutates fulfillment array to add stock and in_transit for each cluster

   Example input stocks:
   [{
     "warehouseName": "Тула",
     "supplierArticle": "D81250",
     "techSize": "XL",
     "quantity": 33,
     "inWayToClient": 1,
     "inWayFromClient": 0
   }]

   Example output fulfillment:
   [{
     article: 'D81250-XL',
     name: 'Product name',
     clusters: {
       'Центральный': {
         fbo_total: 1,
         fbs_total: 0,
         total: 1,
         daily: 0.036,
         stock: 33,           // quantity from warehouse
         in_transit: 1        // inWayToClient + inWayFromClient
       }
     }
   }]
*/
function calculateStocks(fulfillment, stocks) {
  // Create warehouse to cluster map
  const warehouseToCluster = wb.createWarehouseToClusterMap();

  // Create a map for quick product lookup by article
  const productMap = new Map();
  fulfillment.forEach(product => {
    productMap.set(product.article, product);
  });

  // Debug: Track matching stats
  let matchedCount = 0;
  let notFoundCount = 0;
  const notFoundSamples = new Set();
  const unmappedWarehouses = new Set();

  // Aggregate stocks by product and cluster
  stocks.forEach(stock => {
    // Build article from supplierArticle and techSize
    // Skip techSize if it's:
    // - '0' (default/universal)
    // - 'универсальный' (universal/one-size)
    // - shoe size pattern like '40-41', '46-47', '44-45' (treated as single SKU)
    const isShoeSize = stock.techSize && /^\d{2}-\d{2}$/.test(stock.techSize);
    const shouldSkipSize = !stock.techSize ||
      stock.techSize === '0' ||
      stock.techSize === 'универсальный' ||
      isShoeSize;

    const article = shouldSkipSize
      ? stock.supplierArticle
      : `${stock.supplierArticle}-${stock.techSize}`;

    const cluster = warehouseToCluster[stock.warehouseName] || 'Unknown';
    const product = productMap.get(article);

    if (!product) {
      // Product not found in catalog - skip
      notFoundCount++;
      if (notFoundSamples.size < 10) {
        notFoundSamples.add(article);
      }
      return;
    }

    matchedCount++;

    // Skip if cluster is Unknown or not in our cluster list
    if (!product.clusters[cluster]) {
      unmappedWarehouses.add(stock.warehouseName);
      return;
    }

    // Add stock quantity (cluster already initialized)
    product.clusters[cluster].stock += stock.quantity || 0;
  });

  // Debug output
  // console.log(`\n=== Stock Matching Stats ===`);
  // console.log(`Matched: ${matchedCount} stock records`);
  // console.log(`Not found: ${notFoundCount} stock records`);
  if (notFoundSamples.size > 0) {
    console.log(`\nSample articles not found in catalog:`);
    Array.from(notFoundSamples).forEach(article => console.log(`  - ${article}`));
  }

  if (unmappedWarehouses.size > 0) {
    console.log(`\n=== Unmapped Warehouses in stocks (${unmappedWarehouses.size}) ===`);
    console.log(`The following warehouses are not in wbConfig.clusters:`);
    Array.from(unmappedWarehouses).sort().forEach(warehouse => console.log(`  - "${warehouse}"`));
  }
}

/* Calculate in-transit quantities from supply data
   Input: fulfillment array (with products and orders) and supplies from getInTransitSupplies()
   Output: mutates fulfillment array to add in_transit for each cluster

   Example input supplies:
   [{
     supplierArticle: 'D81250',
     techSize: 'XL',
     warehouseName: 'Коледино',
     quantity: 10
   }]
*/
function calculateInTransit(fulfillment, supplies) {
  // Create product lookup map
  const productMap = new Map();
  fulfillment.forEach(product => {
    productMap.set(product.article, product);
  });

  // Create warehouse to cluster mapping
  const warehouseToCluster = {};
  Object.entries(wbConfig.clusters).forEach(([clusterName, warehouses]) => {
    warehouses.forEach(warehouse => {
      warehouseToCluster[warehouse] = clusterName;
    });
  });

  const unmappedWarehouses = new Set();

  // Aggregate supplies by product and cluster
  supplies.forEach(supply => {
    // Build article from supplierArticle and techSize (same logic as orders)
    const isShoeSize = supply.techSize && /^\d{2}-\d{2}$/.test(supply.techSize);
    const shouldSkipSize = !supply.techSize ||
      supply.techSize === '0' ||
      supply.techSize === 'универсальный' ||
      isShoeSize;

    const article = shouldSkipSize
      ? supply.supplierArticle
      : `${supply.supplierArticle}-${supply.techSize}`;

    const cluster = warehouseToCluster[supply.warehouseName] || 'Unknown';
    const product = productMap.get(article);

    if (!product) {
      // Product not found in catalog - skip
      return;
    }

    if (!product.clusters[cluster]) {
      unmappedWarehouses.add(supply.warehouseName);
      return;
    }

    // Add in-transit quantity
    product.clusters[cluster].in_transit += supply.quantity || 0;
  });

  if (unmappedWarehouses.size > 0) {
    console.log(`\n=== Unmapped Warehouses in supplies (${unmappedWarehouses.size}) ===`);
    console.log(`The following warehouses are not in wbConfig.clusters:`);
    Array.from(unmappedWarehouses).sort().forEach(warehouse => console.log(`  - "${warehouse}"`));
  }
}

/* Calculate supply needs for each product-cluster combination
   Input: fulfillment array with orders, stocks, and in-transit data
   Output: mutates fulfillment array to add supply_need field

   Formula:
   - demandedStock = daily × stockCoverageDays - in_transit
   - remainingStock = max(0, stock - fulfillmentLeadTimeDays × daily)
   - supply_need = round(demandedStock - remainingStock)

   Example:
   - daily: 0.129 (average daily sales)
   - stockCoverageDays: 28 (want 28 days of stock)
   - fulfillmentLeadTimeDays: 14 (takes 14 days to fulfill)
   - stock: 4 (current warehouse stock)
   - in_transit: 2 (already on the way)

   Result:
   - demandedStock = 0.129 × 28 - 2 = 1.612
   - remainingStock = max(0, 4 - 14 × 0.129) = 2.194
   - supply_need = round(1.612 - 2.194) = -1 (negative means no supply needed)
*/
function calculateSupplyNeeds(fulfillment, stockCoverageDays, fulfillmentLeadTimeDays) {
  fulfillment.forEach(product => {
    Object.values(product.clusters).forEach(cluster => {
      const demandedStock = cluster.daily * stockCoverageDays - cluster.in_transit;
      const remainingStock = Math.max(0, cluster.stock - fulfillmentLeadTimeDays * cluster.daily);
      cluster.supply_need = Math.round(demandedStock - remainingStock);
    });
  });
}

/* Result example:
{
  clusterNames: ["Mocква, Казань"],
  fromDate: "2025-09-19T21:00:00.000Z",
  toDate: "2025-10-17T20:59:59.999Z",
  fulfillment: [{
    article: "D81140-L",
    name: "Полукомбинезон рабочий DOWELL White HD",
    price_1c: 1234.56,
    amount_1c: 100,
    clusters: {
      "Казань": {
        fbo_total: 3, // 'Склад WB'
        fbs_total: 1, // 'Склад продавца'
        total: 4,
        daily: 0.129,
        stock: 4,
        in_transit: 2,
        supply_need: 5
      }, 
      "Москва": {}
    }
  }, 
  {}]
}
*/
async function calculateFulfillment(daysCovered = 28, stockCoverageDays = 28, fulfillmentLeadTimeDays = 14) {
  const { fromDate, toDate } = getDateRangeFromYesterday(daysCovered);

  const fulfillment = [];

  console.log("WB ping successful:", await wb.ping());

  const cards = await wb.getAllCards();
  const products = wb.extractProductsFromCards(cards);
  addProducts(fulfillment, products);

  const orders = await wb.getAllOrders(fromDate, toDate);
  const ordersWithClusters = wb.enrichOrdersWithClusters(orders);
  aggregateOrdersByProductsAndClusters(fulfillment, ordersWithClusters, daysCovered);

  const stocks = await wb.getStocks(true);
  calculateStocks(fulfillment, stocks);

  const supplies = await wb.getInTransitSupplies();
  calculateInTransit(fulfillment, supplies);

  calculateSupplyNeeds(fulfillment, stockCoverageDays, fulfillmentLeadTimeDays);

  // 1C STOCK
  const oneCStocks = await oneC.getStock();
  console.log(`Found ${oneCStocks.length} products in 1C stock`);
  merge1CStock(fulfillment, oneCStocks);

  return {
    fulfillment,
    fromDate,
    toDate
  };
}

async function fulfillmentReport(daysCovered = 28, stockCoverageDays = 28, fulfillmentLeadTimeDays = 14) {
  const fs = require('fs').promises;
  const path = require('path');

  const {
    fulfillment,
    fromDate,
    toDate
  } = await calculateFulfillment(daysCovered, stockCoverageDays, fulfillmentLeadTimeDays);

  const now = new Date();
  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  const dateRange = `${formatDate(fromDate)}_${formatDate(toDate)}`;
  const folderName = `WB_${dateRange}_${hours}-${minutes}`;

  const reportsBaseDir = path.join(process.cwd(), 'reports', 'wb');
  const outputDir = path.join(reportsBaseDir, folderName);

  // Create reports base directory and date-specific directory
  await fs.mkdir(outputDir, { recursive: true });
  console.log(`Created directory: reports/wb/${folderName}/`);

  console.log('\nGenerating main WB supply report...');
  const mainBuffer = await Excel.createWbFulfillmentReportBuffer(fulfillment);

  const fname = path.join(outputDir, `wb_fulfillment_${dateRange}.xlsx`);
  await fs.writeFile(fname, mainBuffer);
  console.log(`Saved: ${fname}`);

  console.log('\nGenerating WB cluster supply reports...');
  for (const clusterName of CLUSTER_NAMES) {
    const clusterBuffer = await Excel.createWbClusterFulfillmentReportBuffer(clusterName, fulfillment);
    if (clusterBuffer) {
      const fname = path.join(outputDir, `wb_fulfillment_${clusterName}_${dateRange}.xlsx`);
      await fs.writeFile(fname, clusterBuffer);
      console.log(`Saved: ${fname}`);
    }
  }
}

async function main() {
  await fulfillmentReport();
}

// Only run if executed directly, not when imported as module
if (require.main === module) {
  main().catch(error => {
    console.error('Unhandled error:', error.message || error);
    process.exit(1);
  });
}

module.exports = {
  fulfillmentReport
};
