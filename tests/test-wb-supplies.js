require('dotenv').config();

const WB = require('../services/wb');
const ExcelJS = require('exceljs');
const fs = require('fs').promises;
const path = require('path');

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
    console.log('DEBUG MODE: Limiting to 3 supplies for testing\n');

    const supplies = await wb.getInTransitSupplies(30); // Limit to 3 supplies for debugging

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
      const { wbConfig } = require('../config');
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

    // Export to Excel
    console.log('\n=== Exporting to Excel ===');
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('WB In-Transit Supplies');

    // Status ID to name mapping
    const statusNames = {
      2: 'Запланирована',
      3: 'Разгрузка разрешена',
      4: 'Принимается',
      5: 'Принята',
      6: 'Разгружена'
    };

    // Add headers
    worksheet.columns = [
      { header: 'ID Поставки', key: 'supplyID', width: 20 },
      { header: 'Название Поставки', key: 'supplyName', width: 25 },
      { header: 'Артикул', key: 'supplierArticle', width: 25 },
      { header: 'Размер', key: 'techSize', width: 10 },
      { header: 'Склад', key: 'warehouseName', width: 40 },
      { header: 'Количество', key: 'quantity', width: 12 },
      { header: 'Статус', key: 'status', width: 10 },
      { header: 'Создана', key: 'createdAt', width: 20 },
      { header: 'Закрыта', key: 'closedAt', width: 20 },
      { header: 'Дата сканирования', key: 'scanDate', width: 20 }
    ];

    // Style header row
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' }
    };
    headerRow.eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    });

    // Add data
    supplies.forEach(supply => {
      const statusID = supply.statusID || 0;
      const statusText = statusNames[statusID] || `Статус ${statusID}`;

      worksheet.addRow({
        supplyID: supply.supplyID || '',
        supplyName: supply.supplyName || '',
        supplierArticle: supply.supplierArticle,
        techSize: supply.techSize || '',
        warehouseName: supply.warehouseName,
        quantity: supply.quantity,
        status: statusText,
        createdAt: supply.createdAt || '',
        closedAt: supply.closedAt || '',
        scanDate: supply.scanDate || ''
      });
    });

    // Add summary section
    worksheet.addRow([]);
    worksheet.addRow([]);
    const summaryRow = worksheet.addRow(['', '', 'ИТОГО', '', '', supplies.reduce((sum, s) => sum + s.quantity, 0), '', '', '', '']);
    summaryRow.font = { bold: true };
    summaryRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFCC99' }
    };

    // Save file
    const reportsDir = path.join(process.cwd(), 'reports', 'tests');
    await fs.mkdir(reportsDir, { recursive: true });

    const now = new Date();
    const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
    const filename = path.join(reportsDir, `wb_supplies_${timestamp}.xlsx`);

    await workbook.xlsx.writeFile(filename);
    console.log(`✓ Excel file saved: ${filename}`);
    console.log(`  Total supplies: ${supplies.length}`);
    console.log(`  Total quantity: ${supplies.reduce((sum, s) => sum + s.quantity, 0)}`);

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
