const XLSX = require('xlsx');
const ExcelJS = require('exceljs');
const config = require('../config');

// Cluster order from config.js deliveryDays
const CLUSTER_ORDER = Object.keys(config.deliveryDays);

class Excel {
  static exportToExcel(data, filename = 'export.xlsx') {
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Data');

    XLSX.writeFile(workbook, filename);
    console.log(`Data exported to ${filename}`);
    return filename;
  }

  static async exportToExcelWithHeatmap(data, filename = 'export_heatmap.xlsx') {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Heatmap');

    if (data.length === 0) return filename;

    // Get ALL possible headers from ALL rows (not just first row)
    const allHeaders = new Set(['offer_id', 'name']); // Start with known columns
    data.forEach(row => {
      Object.keys(row).forEach(key => allHeaders.add(key));
    });
    const headers = Array.from(allHeaders);
    worksheet.addRow(headers);

    // Get all quantity values for color scaling
    const quantityValues = [];
    data.forEach(row => {
      headers.forEach(key => {
        if (key !== 'offer_id' && key !== 'name' && typeof row[key] === 'number') {
          quantityValues.push(row[key]);
        }
      });
    });

    const maxQuantity = quantityValues.length > 0 ? Math.max(...quantityValues) : 0;
    const minQuantity = quantityValues.length > 0 ? Math.min(...quantityValues) : 0;

    // Generate color based on quantity
    const getColor = (value) => {
      if (!value || value === 0) return 'FFFFF1';
      const ratio = (value - minQuantity) / (maxQuantity - minQuantity);
      const intensity = Math.round(ratio * 200); // 0-200 for better visibility
      const red = Math.round(255 - (intensity * 0.8)); // Start from light red
      const green = Math.round(255 - (intensity * 0.3)); // Keep some green
      const blue = Math.round(255 - intensity); // Reduce blue more
      return `${red.toString(16).padStart(2, '0')}${green.toString(16).padStart(2, '0')}${blue.toString(16).padStart(2, '0')}`;
    };

    // Add data rows with formatting
    data.forEach((row, rowIndex) => {
      const values = headers.map(header => row[header] || '');
      const excelRow = worksheet.addRow(values);

      headers.forEach((header, colIndex) => {
        const cell = excelRow.getCell(colIndex + 1);

        if (header !== 'offer_id' && header !== 'name' && typeof row[header] === 'number' && row[header] > 0) {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: `FF${getColor(row[header])}` }
          };
          cell.alignment = { horizontal: 'center' };
        }

        // Remove all borders
        cell.border = {
          top: { style: 'none' },
          left: { style: 'none' },
          bottom: { style: 'none' },
          right: { style: 'none' }
        };

        // Set column width
        const column = worksheet.getColumn(colIndex + 1);
        if (header === 'offer_id' || header === 'name') {
          column.width = 25;
        } else {
          column.width = 12;
        }
      });
    });

    // Style header row
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    await workbook.xlsx.writeFile(filename);
    console.log(`Heatmap exported to ${filename} (intensity range: ${minQuantity}-${maxQuantity})`);
    return filename;
  }

  static async exportOrdersWithStocksToExcel(ordersWithStocks, filename = 'orders_with_stocks.xlsx') {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Orders with Stocks');

    if (ordersWithStocks.length === 0) return filename;

    // Get all cluster names from all products (excluding Unknown) and order by config
    const allClusters = new Set();
    ordersWithStocks.forEach(product => {
      Object.keys(product.clusters).forEach(cluster => {
        if (cluster !== 'Unknown') {
          allClusters.add(cluster);
        }
      });
    });

    // Order clusters: first by config.js order, then any remaining clusters alphabetically
    const configClusters = CLUSTER_ORDER.filter(cluster => allClusters.has(cluster));
    const remainingClusters = Array.from(allClusters)
      .filter(cluster => !CLUSTER_ORDER.includes(cluster))
      .sort();
    const clusterNames = [...configClusters, ...remainingClusters];

    // Create 2-level headers
    // Level 1: Product info + cluster names (each spanning 4 columns)
    const headerRow1 = ['Товар', ''];
    clusterNames.forEach(cluster => {
      headerRow1.push(cluster, '', '', ''); // Cluster spans 4 columns
    });
    worksheet.addRow(headerRow1);

    // Level 2: Product details + sales metrics for each cluster
    const headerRow2 = ['Артикул', 'Название'];
    clusterNames.forEach(cluster => {
      headerRow2.push('FBO', 'FBS', 'Дневные', 'Остаток');
    });
    worksheet.addRow(headerRow2);

    // Merge cells for "Товар" header (spans Артикул and Товар columns)
    worksheet.mergeCells(1, 1, 1, 2);
    const productHeaderCell = worksheet.getCell(1, 1);
    productHeaderCell.value = 'Товар';
    productHeaderCell.alignment = { horizontal: 'center' };
    productHeaderCell.font = { bold: true };
    productHeaderCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFDDDDDD' } // Light gray for product section
    };

    // Merge cells for cluster headers (level 1) with alternating colors
    let colIndex = 3; // Start after 'Артикул' and 'Товар'
    clusterNames.forEach((cluster, clusterIndex) => {
      worksheet.mergeCells(1, colIndex, 1, colIndex + 3); // Merge 4 columns
      const cell = worksheet.getCell(1, colIndex);
      cell.value = cluster;
      cell.alignment = { horizontal: 'center' };
      cell.font = { bold: true };

      // Alternate between yellow and green colors
      const isEven = clusterIndex % 2 === 0;
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: isEven ? 'FFFFF2CC' : 'FFE8F5E8' } // Light yellow / Light green
      };
      colIndex += 4;
    });

    // Style second header row with alternating colors
    const row2 = worksheet.getRow(2);
    row2.font = { bold: true };

    // Style product columns in second header row
    const articleCell = row2.getCell(1);
    const productCell = row2.getCell(2);
    articleCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFDDDDDD' } // Light gray
    };
    productCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFDDDDDD' } // Light gray
    };

    // Apply alternating colors to cluster columns in second header row
    colIndex = 3;
    clusterNames.forEach((cluster, clusterIndex) => {
      const isEven = clusterIndex % 2 === 0;
      const bgColor = isEven ? 'FFFFF2CC' : 'FFE8F5E8'; // Light yellow / Light green

      for (let i = 0; i < 4; i++) {
        const cell = row2.getCell(colIndex + i);
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: bgColor }
        };
      }
      colIndex += 4;
    });

    // Add data rows with alternating cluster colors
    ordersWithStocks.forEach(product => {
      const rowData = [product.offer_id, product.name];

      clusterNames.forEach(clusterName => {
        const clusterData = product.clusters[clusterName];
        if (clusterData) {
          rowData.push(
            clusterData.fboTotal || 0,
            clusterData.fbsTotal || 0,
            Math.round(clusterData.daily * 1000) / 1000, // Round to 3 decimals
            clusterData.stock || 0
          );
        } else {
          rowData.push(0, 0, 0, 0);
        }
      });

      const dataRow = worksheet.addRow(rowData);

      // Apply alternating cluster colors and gray font for zeros
      let colIndex = 3;
      clusterNames.forEach((cluster, clusterIndex) => {
        const isEven = clusterIndex % 2 === 0;
        const bgColor = isEven ? 'FFFFFAEF' : 'FFF8FDF8'; // Very light yellow / Very light green

        for (let i = 0; i < 4; i++) {
          const cell = dataRow.getCell(colIndex + i);
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: bgColor }
          };

          // Apply gray font color for zero values
          if (cell.value === 0) {
            cell.font = { color: { argb: 'FF999999' } }; // Gray color for zeros
          }
        }
        colIndex += 4;
      });
    });

    // Set column widths
    worksheet.getColumn(1).width = 15; // Артикул
    worksheet.getColumn(2).width = 45; // Товар (made bigger)
    for (let i = 3; i <= headerRow2.length; i++) {
      worksheet.getColumn(i).width = 10;
    }

    // Freeze the header rows (first 2 rows)
    worksheet.views = [
      { state: 'frozen', xSplit: 0, ySplit: 2 }
    ];

    await workbook.xlsx.writeFile(filename);
    console.log(`Orders with stocks exported to ${filename}`);
    return filename;
  }
}

module.exports = Excel;