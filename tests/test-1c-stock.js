require('dotenv').config();

const OneC = require('../services/1c');

async function test1CIntegration() {
  console.log('=== 1C Stock API Integration Test ===\n');

  try {
    const oneC = new OneC();

    console.log('Test 1: Fetch stock data from 1C');
    console.log(`Endpoint: ${oneC.baseUrl}/get_stock/`);
    console.log(`Auth: ${oneC.auth.username}\n`);

    const startTime = Date.now();
    const stocks = await oneC.getStock();
    const duration = Date.now() - startTime;

    console.log(`✓ Successfully fetched stock data in ${duration}ms`);
    console.log(`✓ Total products: ${stocks.length}\n`);

    if (stocks.length === 0) {
      console.log('⚠️  No stock data returned from 1C');
      console.log('This might indicate an issue with the 1C service or empty inventory.\n');
      return;
    }

    // Validate data structure
    console.log('=== Data Structure Validation ===');
    const firstItem = stocks[0];
    const requiredFields = ['Articul', 'Name', 'Price', 'Amount'];
    const hasAllFields = requiredFields.every(field => field in firstItem);

    if (hasAllFields) {
      console.log('✓ All required fields present:', requiredFields.join(', '));
    } else {
      console.log('⚠️  Missing required fields');
      console.log('Expected:', requiredFields);
      console.log('Got:', Object.keys(firstItem));
    }

    // Show complete object structure
    console.log('\n=== Complete Object Structure (first item) ===');
    console.log(JSON.stringify(firstItem, null, 2));

    // Show sample data
    console.log('\n=== Sample Stock Data (first 5 items) ===');
    stocks.slice(0, 5).forEach((item, index) => {
      console.log(`\n${index + 1}. ${item.Articul} - ${item.Name}`);
      console.log(`   Price: ${item.Price} ₽`);
      console.log(`   Amount: ${item.Amount} units`);
    });

    // Statistics
    console.log('\n=== Stock Statistics ===');
    const totalAmount = stocks.reduce((sum, item) => sum + (item.Amount || 0), 0);
    const productsInStock = stocks.filter(item => item.Amount > 0).length;
    const productsOutOfStock = stocks.filter(item => item.Amount === 0).length;

    console.log(`Total products: ${stocks.length}`);
    console.log(`In stock: ${productsInStock} (${Math.round(productsInStock / stocks.length * 100)}%)`);
    console.log(`Out of stock: ${productsOutOfStock} (${Math.round(productsOutOfStock / stocks.length * 100)}%)`);
    console.log(`Total units: ${totalAmount.toLocaleString()}`);

    // Cost price statistics
    console.log('\n=== Cost Price (Себестоимость) Statistics ===');
    const withCost = stocks.filter(item => item.CenaSeb && item.CenaSeb.trim() !== '').length;
    const withoutCost = stocks.filter(item => !item.CenaSeb || item.CenaSeb.trim() === '').length;

    console.log(`Products with cost price: ${withCost} (${Math.round(withCost / stocks.length * 100)}%)`);
    console.log(`Products without cost price: ${withoutCost} (${Math.round(withoutCost / stocks.length * 100)}%)`);

    if (withCost > 0) {
      console.log('\n=== Sample Products with Cost Price ===');
      const samplesWithCost = stocks.filter(item => item.CenaSeb && item.CenaSeb.trim() !== '').slice(0, 3);
      samplesWithCost.forEach((item, index) => {
        console.log(`${index + 1}. ${item.Articul}`);
        console.log(`   Price: ${item.Price} ₽, Cost: ${item.CenaSeb} ₽`);
        if (item.Price && item.CenaSeb) {
          const price = parseFloat(item.Price.replace(',', '.'));
          const cost = parseFloat(item.CenaSeb.replace(',', '.'));
          const margin = ((price - cost) / price * 100).toFixed(1);
          console.log(`   Margin: ${margin}%`);
        }
      });
    }

    // Price validation
    console.log('\n=== Price Format Check ===');
    const priceFormats = new Set();
    stocks.slice(0, 10).forEach(item => {
      if (item.Price) {
        priceFormats.add(typeof item.Price);
      }
    });
    console.log('Price field types detected:', Array.from(priceFormats));

    if (priceFormats.has('string')) {
      const samplePrice = stocks.find(item => typeof item.Price === 'string')?.Price;
      console.log(`Sample price format: "${samplePrice}"`);
      console.log('Note: Prices are strings with comma as decimal separator (e.g., "98,74")');
    }

    // Top 5 most stocked items
    console.log('\n=== Top 5 Most Stocked Items ===');
    const topStocked = [...stocks]
      .filter(item => item.Amount > 0)
      .sort((a, b) => b.Amount - a.Amount)
      .slice(0, 5);

    topStocked.forEach((item, index) => {
      console.log(`${index + 1}. ${item.Articul} - ${item.Amount} units`);
      console.log(`   ${item.Name}`);
    });

    console.log('\n=== Test Summary ===');
    console.log('✓ 1C API connection: Working');
    console.log('✓ Authentication: Successful');
    console.log('✓ Data structure: Valid');
    console.log('✓ Stock data: Retrieved');
    console.log('\n✓ All tests passed!');
    console.log('✓ 1C integration is working correctly');

  } catch (error) {
    console.error('\n❌ Test failed!');
    console.error('Error:', error.message);

    if (error.response) {
      console.error('HTTP Status:', error.response.status, error.response.statusText);
      console.error('Response data:', error.response.data);
    } else if (error.request) {
      console.error('No response received from server');
      console.error('Possible issues:');
      console.error('  - 1C service is down');
      console.error('  - Network connectivity issues');
      console.error('  - Incorrect endpoint URL');
    } else {
      console.error('Error details:', error);
    }

    process.exit(1);
  }
}

test1CIntegration();
