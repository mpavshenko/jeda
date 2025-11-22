require('dotenv').config();

const WB = require('./services/wb');

async function testSuppliesIntegration() {
  console.log('=== WB Supplies API Integration Test ===\n');

  try {
    const wb = new WB();

    // Test 1: Ping WB API
    console.log('Test 1: Ping WB API');
    const pingResult = await wb.ping();
    console.log('✓ Ping successful:', pingResult);
    console.log();

    // Test 2: Fetch in-transit supplies
    console.log('Test 2: Fetch in-transit supplies');
    console.log('Fetching supplies with status 2, 3, 4 (Planned, Unloading allowed, Accepting)...\n');

    const supplies = await wb.getInTransitSupplies();

    console.log(`\n✓ Successfully fetched ${supplies.length} products in transit`);

    if (supplies.length === 0) {
      console.log('\n⚠️  No in-transit supplies found.');
      console.log('This is normal if you don\'t have any active supply shipments.');
    } else {
      console.log('\n=== Sample Supply Data (first 5) ===');
      supplies.slice(0, 5).forEach((supply, index) => {
        console.log(`\n${index + 1}. ${supply.supplierArticle}${supply.techSize ? `-${supply.techSize}` : ''}`);
        console.log(`   Warehouse: ${supply.warehouseName}`);
        console.log(`   Quantity: ${supply.quantity}`);
      });

      // Aggregate by warehouse
      const byWarehouse = {};
      supplies.forEach(supply => {
        if (!byWarehouse[supply.warehouseName]) {
          byWarehouse[supply.warehouseName] = {
            count: 0,
            totalQuantity: 0,
            products: new Set()
          };
        }
        byWarehouse[supply.warehouseName].count++;
        byWarehouse[supply.warehouseName].totalQuantity += supply.quantity;
        byWarehouse[supply.warehouseName].products.add(
          supply.supplierArticle + (supply.techSize ? `-${supply.techSize}` : '')
        );
      });

      console.log('\n=== Summary by Warehouse ===');
      Object.entries(byWarehouse).forEach(([warehouse, stats]) => {
        console.log(`\n${warehouse}:`);
        console.log(`  Products: ${stats.products.size} unique`);
        console.log(`  Total items: ${stats.totalQuantity}`);
      });

      // Check for unmapped warehouses (not in wbConfig)
      const { wbConfig } = require('./config');
      const mappedWarehouses = new Set();
      Object.values(wbConfig.clusters).forEach(warehouses => {
        warehouses.forEach(w => mappedWarehouses.add(w));
      });

      const unmappedWarehouses = Object.keys(byWarehouse).filter(w => !mappedWarehouses.has(w));
      if (unmappedWarehouses.length > 0) {
        console.log('\n⚠️  Unmapped Warehouses (not in wbConfig):');
        unmappedWarehouses.forEach(w => console.log(`  - "${w}"`));
      } else {
        console.log('\n✓ All warehouses are mapped to clusters');
      }
    }

    console.log('\n=== Test Summary ===');
    console.log('✓ All tests passed!');
    console.log('✓ Supplies API integration is working correctly');

  } catch (error) {
    console.error('\n❌ Test failed!');
    console.error('Error:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    process.exit(1);
  }
}

testSuppliesIntegration();
