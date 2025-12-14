require('dotenv').config();
const Ozon = require('../../services/ozon');

/**
 * Integration test for getSupplyOrderIds
 *
 * This test:
 * 1. Fetches all supply order IDs from Ozon API
 * 2. Validates the response structure
 * 3. Shows statistics and sample data
 *
 * Run with: node tests/test-supply-order-ids.js
 */

(async () => {
  try {
    const ozon = new Ozon();

    console.log('Testing getSupplyOrderIds...\n');

    // Fetch supply order IDs
    const startTime = Date.now();
    const supplyOrderIds = await ozon.getSupplyOrderIds();
    const duration = Date.now() - startTime;

    // Validate response
    if (!Array.isArray(supplyOrderIds)) {
      throw new Error('Expected array of supply order IDs');
    }

    // Display statistics
    console.log('=== Test Results ===');
    console.log(`✓ Successfully fetched supply order IDs`);
    console.log(`✓ Duration: ${duration}ms`);
    console.log(`✓ Total supply orders: ${supplyOrderIds.length}`);
    console.log(`✓ API calls made: ${ozon.getApiCallCount()}`);

    if (supplyOrderIds.length > 0) {
      console.log('\n=== Sample Data ===');
      console.log('First 5 supply order IDs:');
      supplyOrderIds.slice(0, 5).forEach((id, index) => {
        console.log(`  ${index + 1}. ${id}`);
      });

      // Validate ID format (should be numeric strings)
      const invalidIds = supplyOrderIds.filter(id => !/^\d+$/.test(String(id)));
      if (invalidIds.length > 0) {
        console.warn(`\n⚠ Warning: Found ${invalidIds.length} supply order IDs with unexpected format`);
        console.warn('Sample invalid IDs:', invalidIds.slice(0, 3));
      } else {
        console.log('\n✓ All supply order IDs have valid format');
      }

      // Check for duplicates
      const uniqueIds = new Set(supplyOrderIds);
      if (uniqueIds.size !== supplyOrderIds.length) {
        console.warn(`\n⚠ Warning: Found ${supplyOrderIds.length - uniqueIds.size} duplicate IDs`);
      } else {
        console.log('✓ No duplicate IDs found');
      }
    } else {
      console.log('\nℹ No supply orders found in the system');
      console.log('This might be normal if there are no active supply orders');
    }

    console.log('\n=== Test Passed ✓ ===');
    process.exit(0);

  } catch (error) {
    console.error('\n=== Test Failed ✗ ===');
    console.error('Error:', error.message);
    if (error.response) {
      console.error('API Response:', error.response.data);
    }
    console.error('\nStack trace:', error.stack);
    process.exit(1);
  }
})();
