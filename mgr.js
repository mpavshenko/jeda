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
      product.amount_1c = stock1C.amount;
      product.brand = stock1C.brand;
      product.group = stock1C.group;
      product.subgroup = stock1C.subgroup;
    } else {
      product.price_1c = null;
      product.cost_1c = null;
      product.amount_1c = null;
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

  // Flatten to products
  const fboOrderedProducts = ozon.getFlattenedOrderedProducts(fboOrders);
  console.log(`Found ${fboOrderedProducts.length} FBO ordered products`);

  // Aggregate by product (offer_id)
  const productFboMap = {};
  fboOrderedProducts.forEach(item => {
    const offerId = item.offer_id;
    if (!productFboMap[offerId]) {
      productFboMap[offerId] = {
        offer_id: offerId,
        name: item.name,
        fbo_count: 0,
        stock_count: 0
      };
    }
    productFboMap[offerId].fbo_count += item.quantity;
  });

  // Fetch stocks
  const allStocks = await ozon.getAllStocks();
  console.log(`Found ${allStocks.length} stock entries`);

  // Aggregate stocks by product (item_code is the same as offer_id)
  const stockMap = {};
  allStocks.forEach(item => {
    const itemCode = item.item_code;
    if (!stockMap[itemCode]) {
      stockMap[itemCode] = 0;
    }
    // Sum all stock amounts: free to sell + reserved + promised
    const totalStock = (item.free_to_sell_amount || 0) + (item.reserved_amount || 0) + (item.promised_amount || 0);
    stockMap[itemCode] += totalStock;
  });

  // Merge stock data into products
  Object.keys(productFboMap).forEach(offerId => {
    productFboMap[offerId].stock_count = stockMap[offerId] || 0;
  });

  const products = Object.values(productFboMap);
  console.log(`Aggregated into ${products.length} unique products`);

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
  const folderName = `${dateRange}_${hours}-${minutes}`;

  const reportsBaseDir = path.join(process.cwd(), 'reports', 'ozon');
  const outputDir = path.join(reportsBaseDir, folderName);

  // Create reports directory
  await fs.mkdir(outputDir, { recursive: true });
  console.log(`Created directory: reports/ozon/${folderName}/`);

  console.log('\nGenerating management hierarchy report...');
  const buffer = await Excel.createManagementHierarchyReportBuffer(products);

  const fname = path.join(outputDir, `ozon_management_${dateRange}.xlsx`);
  await fs.writeFile(fname, buffer);
  console.log(`Saved: ${fname}`);

  console.log('\n=== Report Summary ===');
  console.log(`Total products with FBO sales: ${products.length}`);
  console.log(`Total FBO units sold: ${products.reduce((sum, p) => sum + p.fbo_count, 0)}`);
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
