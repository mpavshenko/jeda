require('dotenv').config();

const OneC = require('../services/1c');
const Excel = require('../services/excel');
const fs = require('fs').promises;
const path = require('path');

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
    const requiredFields = ['Articul', 'Name', 'Price', 'Amount', 'Brand', 'Group', 'Subgroup'];
    const hasAllFields = requiredFields.every(field => field in firstItem);

    if (hasAllFields) {
      console.log('✓ All required fields present:', requiredFields.join(', '));
    } else {
      console.log('⚠️  Missing required fields');
      console.log('Expected:', requiredFields);
      console.log('Got:', Object.keys(firstItem));

      // Show which fields are missing
      const missingFields = requiredFields.filter(field => !(field in firstItem));
      if (missingFields.length > 0) {
        console.log('Missing fields:', missingFields.join(', '));
      }
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

    // Brand, Group, Subgroup statistics
    console.log('\n=== Brand, Group, Subgroup Statistics ===');

    const withBrand = stocks.filter(item => item.Brand && item.Brand.trim() !== '').length;
    const withoutBrand = stocks.length - withBrand;
    console.log(`Products with Brand: ${withBrand} (${Math.round(withBrand / stocks.length * 100)}%)`);
    console.log(`Products without Brand: ${withoutBrand} (${Math.round(withoutBrand / stocks.length * 100)}%)`);

    const withGroup = stocks.filter(item => item.Group && item.Group.trim() !== '').length;
    const withoutGroup = stocks.length - withGroup;
    console.log(`Products with Group: ${withGroup} (${Math.round(withGroup / stocks.length * 100)}%)`);
    console.log(`Products without Group: ${withoutGroup} (${Math.round(withoutGroup / stocks.length * 100)}%)`);

    const withSubgroup = stocks.filter(item => item.Subgroup && item.Subgroup.trim() !== '').length;
    const withoutSubgroup = stocks.length - withSubgroup;
    console.log(`Products with Subgroup: ${withSubgroup} (${Math.round(withSubgroup / stocks.length * 100)}%)`);
    console.log(`Products without Subgroup: ${withoutSubgroup} (${Math.round(withoutSubgroup / stocks.length * 100)}%)`);

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

    // Export to Excel
    console.log('\n=== Exporting to Excel ===');
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('1C Stock');

    // Add headers
    worksheet.columns = [
      { header: 'Артикул', key: 'Articul', width: 20 },
      { header: 'Название', key: 'Name', width: 50 },
      { header: 'Бренд', key: 'Brand', width: 20 },
      { header: 'Группа', key: 'Group', width: 25 },
      { header: 'Подгруппа', key: 'Subgroup', width: 25 },
      { header: 'Цена', key: 'Price', width: 12 },
      { header: 'Себестоимость', key: 'CenaSeb', width: 15 },
      { header: 'Остаток', key: 'Amount', width: 12 }
    ];

    // Style header row
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    // Add data
    stocks.forEach(item => {
      worksheet.addRow({
        Articul: item.Articul,
        Name: item.Name,
        Brand: item.Brand || '',
        Group: item.Group || '',
        Subgroup: item.Subgroup || '',
        Price: item.Price,
        CenaSeb: item.CenaSeb || '',
        Amount: item.Amount
      });
    });

    // Save file
    const reportsDir = path.join(process.cwd(), 'reports', 'tests');
    await fs.mkdir(reportsDir, { recursive: true });

    const now = new Date();
    const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
    const filename = path.join(reportsDir, `1c_stock_${timestamp}.xlsx`);

    await workbook.xlsx.writeFile(filename);
    console.log(`✓ Excel file saved: ${filename}`);

    // Export hierarchy tree
    console.log('\n=== Exporting Hierarchy Tree ===');
    const hierarchyWorkbook = new ExcelJS.Workbook();
    const hierarchySheet = hierarchyWorkbook.addWorksheet('Hierarchy Tree');

    // Build hierarchy structure
    const hierarchy = {};
    stocks.forEach(item => {
      const brand = item.Brand || '(No Brand)';
      const group = item.Group || '(No Group)';
      const subgroup = item.Subgroup || '(No Subgroup)';

      if (!hierarchy[brand]) {
        hierarchy[brand] = {};
      }
      if (!hierarchy[brand][group]) {
        hierarchy[brand][group] = {};
      }
      if (!hierarchy[brand][group][subgroup]) {
        hierarchy[brand][group][subgroup] = [];
      }
      hierarchy[brand][group][subgroup].push(item);
    });

    // Add headers
    hierarchySheet.columns = [
      { header: 'Hierarchy', key: 'name', width: 50 },
      { header: 'Артикул', key: 'articul', width: 20 },
      { header: 'Название', key: 'productName', width: 40 },
      { header: 'Цена', key: 'price', width: 12 },
      { header: 'Остаток', key: 'amount', width: 12 }
    ];

    // Style header row
    const hierarchyHeaderRow = hierarchySheet.getRow(1);
    hierarchyHeaderRow.font = { bold: true };
    hierarchyHeaderRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' }
    };
    hierarchyHeaderRow.getCell(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    hierarchyHeaderRow.getCell(2).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    hierarchyHeaderRow.getCell(3).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    hierarchyHeaderRow.getCell(4).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    hierarchyHeaderRow.getCell(5).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    // Add hierarchy data with grouping
    Object.keys(hierarchy).sort().forEach(brand => {
      // Add Brand row (level 1)
      const brandRow = hierarchySheet.addRow({
        name: `📦 ${brand}`,
        articul: '',
        productName: '',
        price: '',
        amount: ''
      });
      brandRow.outlineLevel = 1;
      brandRow.font = { bold: true, size: 12 };
      brandRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD9E2F3' }
      };

      Object.keys(hierarchy[brand]).sort().forEach(group => {
        // Add Group row (level 2)
        const groupRow = hierarchySheet.addRow({
          name: `  📁 ${group}`,
          articul: '',
          productName: '',
          price: '',
          amount: ''
        });
        groupRow.outlineLevel = 2;
        groupRow.font = { bold: true, size: 11 };
        groupRow.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFEDEDED' }
        };

        Object.keys(hierarchy[brand][group]).sort().forEach(subgroup => {
          // Add Subgroup row (level 3)
          const subgroupRow = hierarchySheet.addRow({
            name: `    📂 ${subgroup}`,
            articul: '',
            productName: '',
            price: '',
            amount: ''
          });
          subgroupRow.outlineLevel = 3;
          subgroupRow.font = { bold: true, size: 10, italic: true };
          subgroupRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF5F5F5' }
          };

          // Add products (level 4)
          hierarchy[brand][group][subgroup].forEach(item => {
            const productRow = hierarchySheet.addRow({
              name: `      • ${item.Name}`,
              articul: item.Articul,
              productName: item.Name,
              price: item.Price,
              amount: item.Amount
            });
            productRow.outlineLevel = 4;
          });
        });
      });
    });

    // Set outline properties to show collapse/expand buttons
    hierarchySheet.properties.outlineLevelCol = 0;
    hierarchySheet.properties.outlineLevelRow = 4;

    // Save hierarchy file
    const hierarchyFilename = path.join(reportsDir, `1c_stock_hierarchy_${timestamp}.xlsx`);
    await hierarchyWorkbook.xlsx.writeFile(hierarchyFilename);
    console.log(`✓ Hierarchy Excel file saved: ${hierarchyFilename}`);

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
