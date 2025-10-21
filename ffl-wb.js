require('dotenv').config();

const WB = require('./services/wb');
const { getDateRangeFromYesterday } = require('./utils/dates');
const wb = new WB();


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
        fbo_total: 3,
        fbs_total: 1,
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
  const fulfillment = [];

  const products = await wb.getAllProducts({ limit: 10 });
  addProducts(fulfillment, products);

  const fboOrders = await wb.getFboOrders();
  const fbsOrders = await wb.getFbsOrders();
  calcOrdersByCluster(fulfillment, fboOrders, fbsOrders)

}

async function main() {
  console.log("=== WB Token Information ===");
  try {
    const tokenInfo = wb.getTokenInfo();
    console.log("Token expires at:", tokenInfo.expiresAt);
    console.log("User ID:", tokenInfo.userId);
    console.log("Seller ID:", tokenInfo.sellerId);
    console.log("\nToken Scopes:");
    tokenInfo.scopes.forEach(scope => console.log(`  - ${scope}`));
    console.log("\nFull payload:", JSON.stringify(tokenInfo.payload, null, 2));
  } catch (error) {
    console.error("Failed to decode token:", error.message);
  }

  console.log("\n=== Testing WB API connection ===");

  try {
    const result = await wb.ping();
    console.log("Ping successful:", result);
  } catch (error) {
    console.error("Ping failed:", error.message);
  }

  console.log("\n=== Fetching all products ===");

  try {
    const products = await wb.getAllProducts({ limit: 10 });
    console.log("Products fetched successfully:");
    console.log(products[0]);
  } catch (error) {
    console.error("Failed to fetch products:", error.message);
  }

  console.log("\n=== Testing FBS Orders ===");

  try {
    const { fromDate, toDate } = getDateRangeFromYesterday(28);
    console.log(`Fetching FBS orders from ${fromDate.toISOString()} to ${toDate.toISOString()}`);

    const fbsOrders = await wb.getAllFbsOrders(fromDate, toDate);
    console.log(`\nFetched ${fbsOrders.length} FBS orders`);

    if (fbsOrders.length > 0) {
      console.log("\nFirst order sample:");
      console.log(JSON.stringify(fbsOrders[0], null, 2));

      // Group by warehouse
      const byWarehouse = {};
      fbsOrders.forEach(order => {
        const warehouseName = order.offices[0] || `WH-${order.warehouseId}`;
        if (!byWarehouse[warehouseName]) {
          byWarehouse[warehouseName] = 0;
        }
        byWarehouse[warehouseName]++;
      });

      console.log("\nOrders by warehouse:");
      Object.entries(byWarehouse).forEach(([warehouse, count]) => {
        console.log(`  ${warehouse}: ${count} orders`);
      });
    }
  } catch (error) {
    console.error("Failed to fetch FBS orders:", error.message);
  }

  console.log("\n=== Testing Unified Orders (Statistics API) ===");

  try {
    const { fromDate, toDate } = getDateRangeFromYesterday(7);
    console.log(`Fetching all orders from ${fromDate.toISOString()} to ${toDate.toISOString()}`);

    const allOrders = await wb.getAllOrders(fromDate, toDate);
    console.log(`\nFetched ${allOrders.length} total orders`);

    if (allOrders.length > 0) {
      console.log("\nFirst order sample:");
      console.log(JSON.stringify(allOrders[0], null, 2));

      // Group by warehouse name and type
      const byWarehouse = {};
      const byType = {};

      allOrders.forEach(order => {
        const warehouseName = order.warehouseName || 'Unknown';
        const warehouseType = order.warehouseType || 'Unknown';

        // Track warehouse stats
        if (!byWarehouse[warehouseName]) {
          byWarehouse[warehouseName] = {};
        }
        if (!byWarehouse[warehouseName][warehouseType]) {
          byWarehouse[warehouseName][warehouseType] = 0;
        }
        byWarehouse[warehouseName][warehouseType]++;

        // Track type totals
        if (!byType[warehouseType]) {
          byType[warehouseType] = 0;
        }
        byType[warehouseType]++;
      });

      console.log("\nOrders by warehouse and type:");
      Object.entries(byWarehouse).forEach(([warehouse, types]) => {
        const total = Object.values(types).reduce((sum, count) => sum + count, 0);
        console.log(`  ${warehouse} (Total: ${total}):`);
        Object.entries(types).forEach(([type, count]) => {
          console.log(`    ${type}: ${count}`);
        });
      });

      console.log("\nTotal by warehouse type:");
      Object.entries(byType).forEach(([type, count]) => {
        console.log(`  ${type}: ${count}`);
      });
    }
  } catch (error) {
    console.error("Failed to fetch orders from statistics API:", error.message);
  }
}

main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
