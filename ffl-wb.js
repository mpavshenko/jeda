require('dotenv').config();

const WB = require('./services/wb');
const { getDateRangeFromYesterday } = require('./utils/dates');
const wb = new WB();
const Excel = require('./services/excel');


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
  const { fromDate, toDate } = getDateRangeFromYesterday(daysCovered);

  const fulfillment = [];

  console.log("WB ping successful:", await wb.ping());

  const cards = await wb.getAllCards();
  const products = wb.extractProductsFromCards(cards);
  // addProducts(fulfillment, products);

  const orders = await wb.getAllOrders(fromDate, toDate);
  const enrichedOrders = wb.enrichOrdersWithClusters(orders);

  // Calculate order counts by cluster
  const orderCountsByCluster = {};
  enrichedOrders.forEach(order => {
    const cluster = order.cluster || 'Unknown';
    orderCountsByCluster[cluster] = (orderCountsByCluster[cluster] || 0) + 1;
  });

  console.log('\n=== Order counts by cluster ===');
  Object.entries(orderCountsByCluster)
    .sort(([, a], [, b]) => b - a) // Sort by count descending
    .forEach(([cluster, count]) => {
      console.log(`${cluster}: ${count}`);
    });

  // Find warehouses with unknown cluster
  const unknownWarehouses = new Set();
  enrichedOrders.forEach(order => {
    if (order.cluster === 'Unknown') {
      unknownWarehouses.add(order.warehouseName);
    }
  });

  if (unknownWarehouses.size > 0) {
    console.log('\n=== Warehouses with unknown cluster ===');
    Array.from(unknownWarehouses).sort().forEach(warehouse => {
      console.log(`- ${warehouse}`);
    });
  } else {
    console.log('\n✓ All warehouses are mapped to clusters');
  }
}

async function main() {
  await calculateFulfillment();

  // console.log("=== WB Token Information ===");
  // try {
  //   const tokenInfo = wb.getTokenInfo();
  //   console.log("Token expires at:", tokenInfo.expiresAt);
  //   console.log("User ID:", tokenInfo.userId);
  //   console.log("Seller ID:", tokenInfo.sellerId);
  //   console.log("\nToken Scopes:");
  //   tokenInfo.scopes.forEach(scope => console.log(`  - ${scope}`));
  //   console.log("\nFull payload:", JSON.stringify(tokenInfo.payload, null, 2));
  // } catch (error) {
  //   console.error("Failed to decode token:", error.message);
  // }

  // console.log("\n=== Testing WB API connection ===");

  // try {
  //   const result = await wb.ping();
  //   console.log("Ping successful:", result);
  // } catch (error) {
  //   console.error("Ping failed:", error.message);
  // }

  // console.log("\n=== Fetching all products ===");

  // try {
  //   const cards = await wb.getAllCards({ limit: 10 });
  //   console.log("Products fetched successfully:");
  //   console.log(cards[0]);
  //   const products = wb.extractProductsFromCards(cards);
  //   console.log(products[0]);
  //   console.table(products);
  //   Excel.exportToExcel(products);

  // } catch (error) {
  //   console.error("Failed to fetch products:", error.message);
  // }

  // return;

  // console.log("\n=== Testing FBS Orders ===");


  // try {
  //   const { fromDate, toDate } = getDateRangeFromYesterday(7);
  //   console.log(`Fetching all orders from ${fromDate.toISOString()} to ${toDate.toISOString()}`);

  //   const allOrders = await wb.getAllOrders(fromDate, toDate);
  //   console.log(`\nFetched ${allOrders.length} total orders`);

  //   if (allOrders.length > 0) {
  //     console.log("\nFirst order sample:");
  //     console.log(allOrders[0]);
  //     console.log(allOrders[1]);
  //     console.log(allOrders[2]);

  //     // Group by warehouse name and type
  //     const byWarehouse = {};
  //     const byType = {};

  //     allOrders.forEach(order => {
  //       const warehouseName = order.warehouseName || 'Unknown';
  //       const warehouseType = order.warehouseType || 'Unknown';

  //       // Track warehouse stats
  //       if (!byWarehouse[warehouseName]) {
  //         byWarehouse[warehouseName] = {};
  //       }
  //       if (!byWarehouse[warehouseName][warehouseType]) {
  //         byWarehouse[warehouseName][warehouseType] = 0;
  //       }
  //       byWarehouse[warehouseName][warehouseType]++;

  //       // Track type totals
  //       if (!byType[warehouseType]) {
  //         byType[warehouseType] = 0;
  //       }
  //       byType[warehouseType]++;
  //     });

  //     console.log("\nOrders by warehouse and type:");
  //     Object.entries(byWarehouse).forEach(([warehouse, types]) => {
  //       const total = Object.values(types).reduce((sum, count) => sum + count, 0);
  //       console.log(`  ${warehouse} (Total: ${total}):`);
  //       Object.entries(types).forEach(([type, count]) => {
  //         console.log(`    ${type}: ${count}`);
  //       });
  //     });

  //     console.log("\nTotal by warehouse type:");
  //     Object.entries(byType).forEach(([type, count]) => {
  //       console.log(`  ${type}: ${count}`);
  //     });
  //   }
  // } catch (error) {
  //   console.error("Failed to fetch orders from statistics API:", error.message);
  // }
}

main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
