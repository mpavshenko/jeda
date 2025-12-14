require('dotenv').config();
const Ozon = require('../../services/ozon');

/**
 * Integration test for getSupplyOrdersInfo
 *
 * This test:
 * 1. Fetches first 5 supply order IDs
 * 2. Gets detailed info for those orders
 * 3. Validates response structure
 * 4. Shows sample order data
 *
 * Run with: node tests/ozon/test-supply-orders-info.js
 */

(async () => {
  try {
    const ozon = new Ozon();
    const TEST_LIMIT = 5;

    console.log('Testing getSupplyOrdersInfo...\n');

    // Step 1: Get supply order IDs
    console.log('Step 1: Fetching supply order IDs...');
    const allSupplyOrderIds = await ozon.getSupplyOrderIds();
    console.log(`✓ Found ${allSupplyOrderIds.length} total supply orders`);

    if (allSupplyOrderIds.length === 0) {
      console.log('\nℹ No supply orders found in the system');
      console.log('Test completed successfully (no data to test)');
      process.exit(0);
    }

    // Step 2: Select first 5 IDs
    const testIds = allSupplyOrderIds.slice(0, Math.min(TEST_LIMIT, allSupplyOrderIds.length));
    console.log(`✓ Selected ${testIds.length} IDs for testing:`, testIds);

    // Step 3: Get detailed info
    console.log('\nStep 2: Fetching supply orders info...');
    const startTime = Date.now();
    const orders = await ozon.getSupplyOrdersInfo(testIds);
    const duration = Date.now() - startTime;

    // Validate response
    if (!Array.isArray(orders)) {
      throw new Error('Expected array of orders');
    }

    console.log(`✓ Successfully fetched supply orders info`);
    console.log(`✓ Duration: ${duration}ms`);
    console.log(`✓ Orders returned: ${orders.length}`);
    console.log(`✓ Total API calls: ${ozon.getApiCallCount()}`);

    // Validate we got data for requested IDs
    if (orders.length !== testIds.length) {
      console.warn(`\n⚠ Warning: Requested ${testIds.length} orders but got ${orders.length}`);
    }

    // Display sample data
    if (orders.length > 0) {
      console.log('\n=== Sample Order Data ===');
      const sampleOrder = orders[0];

      console.log('Order structure:');
      console.log(`  order_id: ${sampleOrder.order_id}`);
      console.log(`  order_number: ${sampleOrder.order_number || sampleOrder.supply_order_number || 'N/A'}`);
      console.log(`  state: ${sampleOrder.state || 'N/A'}`);
      console.log(`  created_date: ${sampleOrder.created_date || sampleOrder.created_at || 'N/A'}`);

      // Check supplies structure
      if (sampleOrder.supplies && sampleOrder.supplies.length > 0) {
        const sampleSupply = sampleOrder.supplies[0];
        console.log(`\n  First supply:`);
        console.log(`    supply_id: ${sampleSupply.supply_id || 'N/A'}`);
        console.log(`    bundle_id: ${sampleSupply.bundle_id || 'N/A'}`);
        console.log(`    state: ${sampleSupply.state || 'N/A'}`);
        if (sampleSupply.storage_warehouse) {
          console.log(`    storage_warehouse.warehouse_id: ${sampleSupply.storage_warehouse.warehouse_id}`);
          console.log(`    storage_warehouse.name: ${sampleSupply.storage_warehouse.name || 'N/A'}`);
        } else {
          console.log(`    storage_warehouse_id: ${sampleSupply.storage_warehouse_id || 'N/A'} (old format)`);
        }
      }

      // Show available fields
      console.log('\nAvailable fields in order:');
      Object.keys(sampleOrder).forEach(key => {
        const value = sampleOrder[key];
        const type = Array.isArray(value) ? `Array(${value.length})` : typeof value;
        console.log(`  - ${key}: ${type}`);
      });

      // Validate required fields
      console.log('\n=== Validation ===');
      const requiredFields = ['order_id', 'state'];
      const missingFields = requiredFields.filter(field => !sampleOrder[field]);

      if (missingFields.length > 0) {
        console.warn(`⚠ Missing required fields: ${missingFields.join(', ')}`);
      } else {
        console.log('✓ All required fields present');
      }

      // Show all orders summary
      console.log('\n=== All Orders Summary ===');
      orders.forEach((order, index) => {
        const orderNum = order.order_number || order.supply_order_number || 'N/A';
        const suppliesCount = order.supplies?.length || 0;
        console.log(`${index + 1}. Order: ${orderNum} | State: ${order.state || 'N/A'} | Supplies: ${suppliesCount}`);
      });

      // Count orders by state
      const stateCount = {};
      orders.forEach(order => {
        const state = order.state || 'UNKNOWN';
        stateCount[state] = (stateCount[state] || 0) + 1;
      });

      console.log('\n=== Orders by State ===');
      Object.entries(stateCount).forEach(([state, count]) => {
        console.log(`  ${state}: ${count}`);
      });
    }

    console.log('\n=== Test Passed ✓ ===');
    process.exit(0);

  } catch (error) {
    console.error('\n=== Test Failed ✗ ===');
    console.error('Error:', error.message);
    if (error.response) {
      console.error('API Response:', error.response.data);
      console.error('Status:', error.response.status);
    }
    console.error('\nStack trace:', error.stack);
    process.exit(1);
  }
})();
