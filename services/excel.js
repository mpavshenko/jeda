const XLSX = require('xlsx');
const ExcelJS = require('exceljs');
const { ozonConfig, wbConfig } = require('../config');

const CLUSTER_ORDER = ozonConfig.clusterOrder;

// WB Cluster order from config.js
const WB_CLUSTER_ORDER = Object.keys(wbConfig.clusters);

class Excel {
  static exportToExcel(data, filename = 'export.xlsx') {
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Data');

    XLSX.writeFile(workbook, filename);
    console.log(`Data exported to ${filename}`);
    return filename;
  }

  // ==================== OZON Excel Generation ====================

  static async createFulfillmentReportBuffer(ordersWithStocks) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Orders with Stocks');

    if (ordersWithStocks.length === 0) {
      return await workbook.xlsx.writeBuffer();
    }

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
    // Level 1: Product info + 1C + cluster names (each spanning 6 columns)
    const headerRow1 = ['Товар', '', '1C', ''];
    clusterNames.forEach(cluster => {
      const days = ozonConfig.clusterDeliveryDays[cluster];
      const label = days ? `${cluster} (${days}д)` : cluster;
      headerRow1.push(label, '', '', '', '', ''); // Cluster spans 6 columns
    });
    worksheet.addRow(headerRow1);

    // Level 2: Product details + 1C details + sales metrics for each cluster
    const headerRow2 = ['Артикул', 'Название', 'Цена', 'Остаток'];
    clusterNames.forEach(cluster => {
      headerRow2.push('FBO', 'FBS', 'Дневные', 'Остаток', 'В пути', 'Отправить');
    });
    worksheet.addRow(headerRow2);

    // Merge cells for "Товар" header (spans Артикул and Название columns)
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

    // Merge cells for "1C" header (spans Цена and Остаток columns)
    worksheet.mergeCells(1, 3, 1, 4);
    const oneCHeaderCell = worksheet.getCell(1, 3);
    oneCHeaderCell.value = '1C';
    oneCHeaderCell.alignment = { horizontal: 'center' };
    oneCHeaderCell.font = { bold: true };
    oneCHeaderCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0FF' } // Light blue for 1C section
    };

    // Merge cells for cluster headers (level 1) with alternating colors
    let colIndex = 5; // Start after 'Артикул', 'Название', 'Цена', 'Остаток'
    clusterNames.forEach((cluster, clusterIndex) => {
      worksheet.mergeCells(1, colIndex, 1, colIndex + 5); // Merge 6 columns
      const cell = worksheet.getCell(1, colIndex);
      const days = ozonConfig.clusterDeliveryDays[cluster];
      cell.value = days ? `${cluster} (${days}д)` : cluster;
      cell.alignment = { horizontal: 'center' };
      cell.font = { bold: true };

      // Alternate between yellow and green colors
      const isEven = clusterIndex % 2 === 0;
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: isEven ? 'FFFFF2CC' : 'FFE8F5E8' } // Light yellow / Light green
      };
      colIndex += 6;
    });

    // Style second header row with alternating colors
    const row2 = worksheet.getRow(2);
    row2.font = { bold: true };

    // Style product columns in second header row (Ozon has no barcode)
    const articleCell = row2.getCell(1);
    const nameCell = row2.getCell(2);
    articleCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFDDDDDD' } // Light gray
    };
    nameCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFDDDDDD' } // Light gray
    };

    // Style 1C columns in second header row
    const priceCell = row2.getCell(3);
    const amountCell = row2.getCell(4);
    priceCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0FF' } // Light blue
    };
    amountCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0FF' } // Light blue
    };

    // Apply alternating colors to cluster columns in second header row
    colIndex = 5;
    clusterNames.forEach((cluster, clusterIndex) => {
      const isEven = clusterIndex % 2 === 0;
      const bgColor = isEven ? 'FFFFF2CC' : 'FFE8F5E8'; // Light yellow / Light green

      for (let i = 0; i < 6; i++) {
        const cell = row2.getCell(colIndex + i);
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: bgColor }
        };
      }
      colIndex += 6;
    });

    // Add data rows with alternating cluster colors
    ordersWithStocks.forEach(product => {
      const rowData = [
        product.offer_id,
        product.name,
        product.price_1c ?? '',
        product.amount_1c ?? ''
      ];

      // Calculate total supply across all clusters
      let totalSupply = 0;
      clusterNames.forEach(clusterName => {
        const clusterData = product.clusters[clusterName];
        if (clusterData) {
          totalSupply += clusterData.supply || 0;
          rowData.push(
            clusterData.fboTotal || 0,
            clusterData.fbsTotal || 0,
            Math.round(clusterData.daily * 1000) / 1000, // Round to 3 decimals
            clusterData.stock || 0,
            clusterData.in_transit || 0,
            clusterData.supply || 0
          );
        } else {
          rowData.push(0, 0, 0, 0, 0, 0);
        }
      });

      const dataRow = worksheet.addRow(rowData);

      // Check if amount_1c < total supply, highlight row with red
      const shouldHighlight = product.amount_1c != null && product.amount_1c < totalSupply;

      // Style 1C columns
      const priceCell = dataRow.getCell(3);
      const amountCell = dataRow.getCell(4);

      const oneCBgColor = shouldHighlight ? 'FFFFE0E0' : 'FFF0F0FF'; // Red if highlighted, light blue otherwise

      priceCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: oneCBgColor }
      };
      priceCell.numFmt = '#,##0.00'; // Format as money with 2 decimal places

      amountCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: oneCBgColor }
      };

      // Apply alternating cluster colors and gray font for zeros
      let colIndex = 5;
      clusterNames.forEach((cluster, clusterIndex) => {
        const isEven = clusterIndex % 2 === 0;
        let bgColor = isEven ? 'FFFFFAEF' : 'FFF8FDF8'; // Very light yellow / Very light green
        if (shouldHighlight) {
          bgColor = 'FFFFE0E0'; // Light red if highlighted
        }

        for (let i = 0; i < 6; i++) {
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

          // Make "Отправить" column bold with color coding (last column in each cluster group)
          if (i === 5) {
            const supplyValue = cell.value || 0;
            let fontColor = 'FF999999'; // Light gray for zero

            if (supplyValue > 0) {
              fontColor = 'FF006600'; // Dark green for positive
            } else if (supplyValue < 0) {
              fontColor = 'FF990000'; // Dark red for negative
            }

            cell.font = { bold: true, color: { argb: fontColor } };
          }
        }
        colIndex += 6;
      });
    });

    // Set column widths
    worksheet.getColumn(1).width = 15; // Артикул
    worksheet.getColumn(2).width = 45; // Название
    worksheet.getColumn(3).width = 10; // Цена (1C)
    worksheet.getColumn(4).width = 10; // Остаток (1C)
    for (let i = 5; i <= headerRow2.length; i++) {
      worksheet.getColumn(i).width = 10;
    }

    // Freeze the header rows (first 2 rows) and first column (Артикул)
    worksheet.views = [
      { state: 'frozen', xSplit: 1, ySplit: 2 }
    ];

    return await workbook.xlsx.writeBuffer();
  }


  static async createClusterFulfillmentReportBuffer(clusterName, ordersWithStocks) {
    const clusterData = [];

    ordersWithStocks.forEach(product => {
      const cluster = product.clusters[clusterName];
      if (cluster && cluster.supply && cluster.supply > 0) {
        clusterData.push({
          'Артикул': product.offer_id,
          'Имя': product.name,
          'Количество': cluster.supply
        });
      }
    });

    if (clusterData.length === 0) {
      console.log(`No supply data for cluster: ${clusterName}`);
      return null;
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(clusterName);

    // Add headers
    worksheet.columns = [
      { header: 'Артикул', key: 'Артикул', width: 20 },
      { header: 'Имя', key: 'Имя', width: 50 },
      { header: 'Количество', key: 'Количество', width: 15 }
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
    clusterData.forEach(row => {
      const dataRow = worksheet.addRow(row);
      // Make quantity column bold
      dataRow.getCell(3).font = { bold: true };
    });

    console.log(`Created cluster report for ${clusterName} (${clusterData.length} items)`);
    return await workbook.xlsx.writeBuffer();
  }

  static async createCostSummaryReportBuffer(ordersWithStocks) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Cost Summary');

    if (ordersWithStocks.length === 0) {
      return await workbook.xlsx.writeBuffer();
    }

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
    // Level 1: Product info + 1C + cluster names (each spanning 2 columns) + Total
    const headerRow1 = ['Товар', '', '1C', '', ''];
    clusterNames.forEach(cluster => {
      headerRow1.push(cluster, ''); // Cluster spans 2 columns
    });
    headerRow1.push('Итого');
    worksheet.addRow(headerRow1);

    // Level 2: Product details + stock metrics for each cluster
    const headerRow2 = ['Артикул', 'Название', 'Себест.', 'Цена', 'Остаток'];
    clusterNames.forEach(cluster => {
      headerRow2.push('Остаток', 'Стоимость');
    });
    headerRow2.push('Стоимость');
    worksheet.addRow(headerRow2);

    // Merge cells for "Товар" header (spans Артикул and Название columns)
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

    // Merge cells for "1C" header (spans Себест., Цена and Остаток columns)
    worksheet.mergeCells(1, 3, 1, 5);
    const oneCHeaderCell = worksheet.getCell(1, 3);
    oneCHeaderCell.value = '1C';
    oneCHeaderCell.alignment = { horizontal: 'center' };
    oneCHeaderCell.font = { bold: true };
    oneCHeaderCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0FF' } // Light blue for 1C section
    };

    // Merge cells for cluster headers (level 1) with alternating colors
    let colIndex = 6; // Start after 'Артикул', 'Название', 'Себест.', 'Цена', 'Остаток'
    clusterNames.forEach((cluster, clusterIndex) => {
      worksheet.mergeCells(1, colIndex, 1, colIndex + 1); // Merge 2 columns
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
      colIndex += 2;
    });

    // Style "Итого" header cell
    const totalHeaderCol = 6 + clusterNames.length * 2;
    const totalHeaderCell = worksheet.getCell(1, totalHeaderCol);
    totalHeaderCell.value = 'Итого';
    totalHeaderCell.alignment = { horizontal: 'center' };
    totalHeaderCell.font = { bold: true };
    totalHeaderCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFCC99' } // Orange for totals
    };

    // Style second header row with alternating colors
    const row2 = worksheet.getRow(2);
    row2.font = { bold: true };

    // Style product columns in second header row
    const articleCell = row2.getCell(1);
    const nameCell = row2.getCell(2);
    articleCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFDDDDDD' } // Light gray
    };
    nameCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFDDDDDD' } // Light gray
    };

    // Style 1C columns in second header row
    const costCell = row2.getCell(3);
    const priceCell = row2.getCell(4);
    const stockCell = row2.getCell(5);
    costCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0FF' } // Light blue for 1C section
    };
    priceCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0FF' } // Light blue for 1C section
    };
    stockCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0FF' } // Light blue for 1C section
    };

    // Style total column header in second row
    const totalColCell = row2.getCell(totalHeaderCol);
    totalColCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFCC99' } // Orange for totals
    };

    // Apply alternating colors to cluster columns in second header row
    colIndex = 6;
    clusterNames.forEach((cluster, clusterIndex) => {
      const isEven = clusterIndex % 2 === 0;
      const bgColor = isEven ? 'FFFFF2CC' : 'FFE8F5E8'; // Light yellow / Light green

      for (let i = 0; i < 2; i++) {
        const cell = row2.getCell(colIndex + i);
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: bgColor }
        };
      }
      colIndex += 2;
    });

    // Initialize column totals
    const columnTotals = clusterNames.map(() => 0);

    // Add data rows with alternating cluster colors
    ordersWithStocks.forEach(product => {
      const rowData = [
        product.offer_id,
        product.name,
        product.cost_1c ?? '',
        product.price_1c ?? '',
        product.amount_1c ?? ''
      ];

      let rowTotal = 0;

      clusterNames.forEach((clusterName, clusterIndex) => {
        const clusterData = product.clusters[clusterName];
        if (clusterData) {
          const stock = clusterData.stock || 0;
          const cost = product.cost_1c;
          const stockValue = (cost != null && stock > 0) ? stock * cost : 0;

          rowData.push(
            stock,
            stockValue
          );

          rowTotal += stockValue;
          columnTotals[clusterIndex] += stockValue;
        } else {
          rowData.push(0, 0);
        }
      });

      rowData.push(rowTotal); // Add row total
      const dataRow = worksheet.addRow(rowData);

      // Style 1C columns (columns 3, 4, 5) with 1C blue background
      [3, 4, 5].forEach(colNum => {
        const cell = dataRow.getCell(colNum);
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF0F0FF' } // Light blue for 1C section
        };
        if (cell.value != null && cell.value !== '' && colNum !== 5) {
          cell.numFmt = '#,##0.00'; // Format as money with 2 decimal places (not for amount)
        }
      });

      // Style row total cell with orange background
      const rowTotalCell = dataRow.getCell(totalHeaderCol);
      rowTotalCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFEEDD' } // Light orange for totals
      };
      rowTotalCell.numFmt = '#,##0.00';
      rowTotalCell.font = { bold: true };

      // Apply alternating cluster colors
      let colIndex = 6;
      clusterNames.forEach((cluster, clusterIndex) => {
        const isEven = clusterIndex % 2 === 0;
        const bgColor = isEven ? 'FFFFFAEF' : 'FFF8FDF8'; // Very light yellow / Very light green

        for (let i = 0; i < 2; i++) {
          const cell = dataRow.getCell(colIndex + i);
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: bgColor }
          };

          // Apply gray font color for zero or null values
          if (cell.value === 0 || cell.value === null || cell.value === '') {
            cell.font = { color: { argb: 'FF999999' } }; // Gray color for zeros/nulls
          }

          // Format "Стоимость" column with money formatting (every second column starting from colIndex)
          if (i === 1 && cell.value != null) {
            cell.numFmt = '#,##0.00'; // Format as money with 2 decimal places
          }
        }
        colIndex += 2;
      });
    });

    // Add totals row
    const totalsRowData = ['', 'ИТОГО', '', '', ''];
    let grandTotal = 0;

    clusterNames.forEach((clusterName, clusterIndex) => {
      totalsRowData.push(''); // Empty for stock column
      totalsRowData.push(columnTotals[clusterIndex]); // Total value
      grandTotal += columnTotals[clusterIndex];
    });

    totalsRowData.push(grandTotal); // Grand total
    const totalsRow = worksheet.addRow(totalsRowData);

    // Style totals row
    totalsRow.font = { bold: true };

    // Style "ИТОГО" label cells
    totalsRow.getCell(2).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFCC99' } // Orange for totals
    };

    // Style cluster total cells
    colIndex = 6;
    clusterNames.forEach((cluster, clusterIndex) => {
      // Skip stock column (colIndex)
      const totalCell = totalsRow.getCell(colIndex + 1);
      totalCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFCC99' } // Orange for totals
      };
      totalCell.numFmt = '#,##0.00';
      colIndex += 2;
    });

    // Style grand total cell
    const grandTotalCell = totalsRow.getCell(totalHeaderCol);
    grandTotalCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFF9966' } // Darker orange for grand total
    };
    grandTotalCell.numFmt = '#,##0.00';

    // Set column widths
    worksheet.getColumn(1).width = 15; // Артикул
    worksheet.getColumn(2).width = 45; // Название
    worksheet.getColumn(3).width = 10; // Себест.
    worksheet.getColumn(4).width = 10; // Цена
    worksheet.getColumn(5).width = 10; // Остаток
    for (let i = 6; i <= headerRow2.length; i++) {
      worksheet.getColumn(i).width = 12;
    }

    // Freeze the header rows (first 2 rows) and first column (Артикул)
    worksheet.views = [
      { state: 'frozen', xSplit: 1, ySplit: 2 }
    ];

    return await workbook.xlsx.writeBuffer();
  }

  // ==================== WB Excel Generation ====================

  static async createWbFulfillmentReportBuffer(fulfillment) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('WB Fulfillment');

    if (fulfillment.length === 0) {
      return await workbook.xlsx.writeBuffer();
    }

    // Get all cluster names from config in order
    const clusterNames = WB_CLUSTER_ORDER;

    // Create 2-level headers
    // Level 1: Product info + 1C + cluster names (each spanning 6 columns)
    const headerRow1 = ['Товар', '', '', '1C', ''];
    clusterNames.forEach(cluster => {
      headerRow1.push(cluster, '', '', '', '', ''); // Cluster spans 6 columns
    });
    worksheet.addRow(headerRow1);

    // Level 2: Product details + 1C details + sales metrics for each cluster
    const headerRow2 = ['Артикул', 'Штрихкод', 'Название', 'Цена', 'Остаток'];
    clusterNames.forEach(cluster => {
      headerRow2.push('FBO', 'FBS', 'Дневные', 'Остаток', 'В пути', 'Отправить');
    });
    worksheet.addRow(headerRow2);

    // Merge cells for "Товар" header (spans Артикул, Штрихкод and Название columns)
    worksheet.mergeCells(1, 1, 1, 3);
    const productHeaderCell = worksheet.getCell(1, 1);
    productHeaderCell.value = 'Товар';
    productHeaderCell.alignment = { horizontal: 'center' };
    productHeaderCell.font = { bold: true };
    productHeaderCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFDDDDDD' } // Light gray for product section
    };

    // Merge cells for "1C" header (spans Цена and Остаток columns)
    worksheet.mergeCells(1, 4, 1, 5);
    const oneCHeaderCell = worksheet.getCell(1, 4);
    oneCHeaderCell.value = '1C';
    oneCHeaderCell.alignment = { horizontal: 'center' };
    oneCHeaderCell.font = { bold: true };
    oneCHeaderCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0FF' } // Light blue for 1C section
    };

    // Merge cells for cluster headers (level 1) with alternating colors
    let colIndex = 6; // Start after 'Артикул', 'Штрихкод', 'Название', 'Цена', 'Остаток' (columns 1-5)
    clusterNames.forEach((cluster, clusterIndex) => {
      worksheet.mergeCells(1, colIndex, 1, colIndex + 5); // Merge 6 columns
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
      colIndex += 6;
    });

    // Style second header row with alternating colors
    const row2 = worksheet.getRow(2);
    row2.font = { bold: true };

    // Style product columns in second header row
    const articleCell = row2.getCell(1);
    const barcodeCell = row2.getCell(2);
    const productCell = row2.getCell(3);
    articleCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFDDDDDD' } // Light gray
    };
    barcodeCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFDDDDDD' } // Light gray
    };
    productCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFDDDDDD' } // Light gray
    };

    // Style 1C columns in second header row
    const priceCell = row2.getCell(4);
    const amountCell = row2.getCell(5);
    priceCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0FF' } // Light blue
    };
    amountCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0FF' } // Light blue
    };

    // Apply alternating colors to cluster columns in second header row
    colIndex = 6;
    clusterNames.forEach((cluster, clusterIndex) => {
      const isEven = clusterIndex % 2 === 0;
      const bgColor = isEven ? 'FFFFF2CC' : 'FFE8F5E8'; // Light yellow / Light green

      for (let i = 0; i < 6; i++) {
        const cell = row2.getCell(colIndex + i);
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: bgColor }
        };
      }
      colIndex += 6;
    });

    // Add data rows with alternating cluster colors
    fulfillment.forEach(product => {
      const rowData = [
        product.article,
        product.barcode ?? '',
        product.name,
        product.price_1c ?? '',
        product.amount_1c ?? ''
      ];

      // Calculate total supply across all clusters
      let totalSupply = 0;
      clusterNames.forEach(clusterName => {
        const clusterData = product.clusters[clusterName];
        if (clusterData) {
          totalSupply += clusterData.supply_need || 0;
          rowData.push(
            clusterData.fbo_total || 0,
            clusterData.fbs_total || 0,
            Math.round(clusterData.daily * 1000) / 1000, // Round to 3 decimals
            clusterData.stock || 0,
            clusterData.in_transit || 0,
            clusterData.supply_need || 0
          );
        } else {
          rowData.push(0, 0, 0, 0, 0, 0);
        }
      });

      const dataRow = worksheet.addRow(rowData);

      // Check if amount_1c < total supply, highlight row with red
      const shouldHighlight = product.amount_1c != null && product.amount_1c < totalSupply;

      // Style 1C columns (column 4=Цена, column 5=Остаток)
      const priceCell = dataRow.getCell(4);
      const amountCell = dataRow.getCell(5);

      const oneCBgColor = shouldHighlight ? 'FFFFE0E0' : 'FFF0F0FF'; // Red if highlighted, light blue otherwise

      priceCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: oneCBgColor }
      };
      priceCell.numFmt = '#,##0.00'; // Format as money with 2 decimal places

      amountCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: oneCBgColor }
      };

      // Apply alternating cluster colors and gray font for zeros (clusters start at column 6)
      let colIndex = 6;
      clusterNames.forEach((cluster, clusterIndex) => {
        const isEven = clusterIndex % 2 === 0;
        let bgColor = isEven ? 'FFFFFAEF' : 'FFF8FDF8'; // Very light yellow / Very light green
        if (shouldHighlight) {
          bgColor = 'FFFFE0E0'; // Light red if highlighted
        }

        for (let i = 0; i < 6; i++) {
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

          // Make "Отправить" column bold with color coding (last column in each cluster group)
          if (i === 5) {
            const supplyValue = cell.value || 0;
            let fontColor = 'FF999999'; // Light gray for zero

            if (supplyValue > 0) {
              fontColor = 'FF006600'; // Dark green for positive
            } else if (supplyValue < 0) {
              fontColor = 'FF990000'; // Dark red for negative
            }

            cell.font = { bold: true, color: { argb: fontColor } };
          }
        }
        colIndex += 6;
      });
    });

    // Set column widths
    worksheet.getColumn(1).width = 15; // Артикул
    worksheet.getColumn(2).width = 15; // Штрихкод
    worksheet.getColumn(3).width = 45; // Название
    worksheet.getColumn(4).width = 10; // Цена
    worksheet.getColumn(5).width = 10; // Остаток (1C)
    for (let i = 6; i <= headerRow2.length; i++) {
      worksheet.getColumn(i).width = 10;
    }

    // Freeze the header rows (first 2 rows) and first column (Артикул)
    worksheet.views = [
      { state: 'frozen', xSplit: 1, ySplit: 2 }
    ];

    return await workbook.xlsx.writeBuffer();
  }

  static async createWbClusterFulfillmentReportBuffer(clusterName, fulfillment) {
    const clusterData = [];

    fulfillment.forEach(product => {
      const cluster = product.clusters[clusterName];
      if (cluster && cluster.supply_need && cluster.supply_need > 0) {
        clusterData.push({
          'Артикул': product.article,
          'Штрихкод': product.barcode ?? '',
          'Имя': product.name,
          'Количество': cluster.supply_need
        });
      }
    });

    if (clusterData.length === 0) {
      console.log(`No supply data for cluster: ${clusterName}`);
      return null;
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(clusterName);

    // Add headers
    worksheet.columns = [
      { header: 'Артикул', key: 'Артикул', width: 20 },
      { header: 'Штрихкод', key: 'Штрихкод', width: 15 },
      { header: 'Имя', key: 'Имя', width: 50 },
      { header: 'Количество', key: 'Количество', width: 15 }
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
    clusterData.forEach(row => {
      const dataRow = worksheet.addRow(row);
      // Make quantity column bold
      dataRow.getCell(3).font = { bold: true };
    });

    console.log(`Created WB cluster report for ${clusterName} (${clusterData.length} items)`);
    return await workbook.xlsx.writeBuffer();
  }

  static async createWbCostSummaryReportBuffer(fulfillment) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Cost Summary');

    if (fulfillment.length === 0) {
      return await workbook.xlsx.writeBuffer();
    }

    // Use WB cluster order from config
    const clusterNames = WB_CLUSTER_ORDER;

    // Create 2-level headers
    // Level 1: Product info + 1C + cluster names (each spanning 2 columns) + Total
    const headerRow1 = ['Товар', '', '1C', '', ''];
    clusterNames.forEach(cluster => {
      headerRow1.push(cluster, ''); // Cluster spans 2 columns
    });
    headerRow1.push('Итого');
    worksheet.addRow(headerRow1);

    // Level 2: Product details + stock metrics for each cluster
    const headerRow2 = ['Артикул', 'Название', 'Себест.', 'Цена', 'Остаток'];
    clusterNames.forEach(cluster => {
      headerRow2.push('Остаток', 'Стоимость');
    });
    headerRow2.push('Стоимость');
    worksheet.addRow(headerRow2);

    // Merge cells for "Товар" header (spans Артикул and Название columns)
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

    // Merge cells for "1C" header (spans Себест., Цена and Остаток columns)
    worksheet.mergeCells(1, 3, 1, 5);
    const oneCHeaderCell = worksheet.getCell(1, 3);
    oneCHeaderCell.value = '1C';
    oneCHeaderCell.alignment = { horizontal: 'center' };
    oneCHeaderCell.font = { bold: true };
    oneCHeaderCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0FF' } // Light blue for 1C section
    };

    // Merge cells for cluster headers (level 1) with alternating colors
    let colIndex = 6; // Start after 'Артикул', 'Название', 'Себест.', 'Цена', 'Остаток'
    clusterNames.forEach((cluster, clusterIndex) => {
      worksheet.mergeCells(1, colIndex, 1, colIndex + 1); // Merge 2 columns
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
      colIndex += 2;
    });

    // Style "Итого" header cell
    const totalHeaderCol = 6 + clusterNames.length * 2;
    const totalHeaderCell = worksheet.getCell(1, totalHeaderCol);
    totalHeaderCell.value = 'Итого';
    totalHeaderCell.alignment = { horizontal: 'center' };
    totalHeaderCell.font = { bold: true };
    totalHeaderCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFCC99' } // Orange for totals
    };

    // Style second header row with alternating colors
    const row2 = worksheet.getRow(2);
    row2.font = { bold: true };

    // Style product columns in second header row
    const articleCell = row2.getCell(1);
    const nameCell = row2.getCell(2);
    articleCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFDDDDDD' } // Light gray
    };
    nameCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFDDDDDD' } // Light gray
    };

    // Style 1C columns in second header row
    const costCell = row2.getCell(3);
    const priceCell = row2.getCell(4);
    const stockCell = row2.getCell(5);
    costCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0FF' } // Light blue for 1C section
    };
    priceCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0FF' } // Light blue for 1C section
    };
    stockCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0FF' } // Light blue for 1C section
    };

    // Style total column header in second row
    const totalColCell = row2.getCell(totalHeaderCol);
    totalColCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFCC99' } // Orange for totals
    };

    // Apply alternating colors to cluster columns in second header row
    colIndex = 6;
    clusterNames.forEach((cluster, clusterIndex) => {
      const isEven = clusterIndex % 2 === 0;
      const bgColor = isEven ? 'FFFFF2CC' : 'FFE8F5E8'; // Light yellow / Light green

      for (let i = 0; i < 2; i++) {
        const cell = row2.getCell(colIndex + i);
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: bgColor }
        };
      }
      colIndex += 2;
    });

    // Initialize column totals
    const columnTotals = clusterNames.map(() => 0);

    // Add data rows with alternating cluster colors
    fulfillment.forEach(product => {
      const rowData = [
        product.article,
        product.name,
        product.cost_1c ?? '',
        product.price_1c ?? '',
        product.amount_1c ?? ''
      ];

      let rowTotal = 0;

      clusterNames.forEach((clusterName, clusterIndex) => {
        const clusterData = product.clusters[clusterName];
        if (clusterData) {
          const stock = clusterData.stock || 0;
          const cost = product.cost_1c;
          const stockValue = (cost != null && stock > 0) ? stock * cost : 0;

          rowData.push(
            stock,
            stockValue
          );

          rowTotal += stockValue;
          columnTotals[clusterIndex] += stockValue;
        } else {
          rowData.push(0, 0);
        }
      });

      rowData.push(rowTotal); // Add row total
      const dataRow = worksheet.addRow(rowData);

      // Style 1C columns (columns 3, 4, 5) with 1C blue background
      [3, 4, 5].forEach(colNum => {
        const cell = dataRow.getCell(colNum);
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF0F0FF' } // Light blue for 1C section
        };
        if (cell.value != null && cell.value !== '' && colNum !== 5) {
          cell.numFmt = '#,##0.00'; // Format as money with 2 decimal places (not for amount)
        }
      });

      // Style row total cell with orange background
      const rowTotalCell = dataRow.getCell(totalHeaderCol);
      rowTotalCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFEEDD' } // Light orange for totals
      };
      rowTotalCell.numFmt = '#,##0.00';
      rowTotalCell.font = { bold: true };

      // Apply alternating cluster colors
      let colIndex = 6;
      clusterNames.forEach((cluster, clusterIndex) => {
        const isEven = clusterIndex % 2 === 0;
        const bgColor = isEven ? 'FFFFFAEF' : 'FFF8FDF8'; // Very light yellow / Very light green

        for (let i = 0; i < 2; i++) {
          const cell = dataRow.getCell(colIndex + i);
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: bgColor }
          };

          // Apply gray font color for zero or null values
          if (cell.value === 0 || cell.value === null || cell.value === '') {
            cell.font = { color: { argb: 'FF999999' } }; // Gray color for zeros/nulls
          }

          // Format "Стоимость" column with money formatting (every second column starting from colIndex)
          if (i === 1 && cell.value != null) {
            cell.numFmt = '#,##0.00'; // Format as money with 2 decimal places
          }
        }
        colIndex += 2;
      });
    });

    // Add totals row
    const totalsRowData = ['', 'ИТОГО', '', '', ''];
    let grandTotal = 0;

    clusterNames.forEach((clusterName, clusterIndex) => {
      totalsRowData.push(''); // Empty for stock column
      totalsRowData.push(columnTotals[clusterIndex]); // Total value
      grandTotal += columnTotals[clusterIndex];
    });

    totalsRowData.push(grandTotal); // Grand total
    const totalsRow = worksheet.addRow(totalsRowData);

    // Style totals row
    totalsRow.font = { bold: true };

    // Style "ИТОГО" label cells
    totalsRow.getCell(2).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFCC99' } // Orange for totals
    };

    // Style cluster total cells
    colIndex = 6;
    clusterNames.forEach((cluster, clusterIndex) => {
      // Skip stock column (colIndex)
      const totalCell = totalsRow.getCell(colIndex + 1);
      totalCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFCC99' } // Orange for totals
      };
      totalCell.numFmt = '#,##0.00';
      colIndex += 2;
    });

    // Style grand total cell
    const grandTotalCell = totalsRow.getCell(totalHeaderCol);
    grandTotalCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFF9966' } // Darker orange for grand total
    };
    grandTotalCell.numFmt = '#,##0.00';

    // Set column widths
    worksheet.getColumn(1).width = 15; // Артикул
    worksheet.getColumn(2).width = 45; // Название
    worksheet.getColumn(3).width = 10; // Себест.
    worksheet.getColumn(4).width = 10; // Цена
    worksheet.getColumn(5).width = 10; // Остаток
    for (let i = 6; i <= headerRow2.length; i++) {
      worksheet.getColumn(i).width = 12;
    }

    // Freeze the header rows (first 2 rows) and first column (Артикул)
    worksheet.views = [
      { state: 'frozen', xSplit: 1, ySplit: 2 }
    ];

    return await workbook.xlsx.writeBuffer();
  }

  // ==================== WB & OZON Excel Generation ====================

  static async createManagementHierarchyReportBuffer(products, daysCovered = 28) {
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Management Report');

    // Build hierarchy: Cluster → Brand → Group → Subgroup → Products
    const hierarchy = {};
    products.forEach(product => {
      const cluster = product.cluster || 'Unknown';
      const brand = product.brand || 'Без бренда';
      const group = product.group || 'Без группы';
      const subgroup = product.subgroup || 'Без подгруппы';

      if (!hierarchy[cluster]) {
        hierarchy[cluster] = {};
      }
      if (!hierarchy[cluster][brand]) {
        hierarchy[cluster][brand] = {};
      }
      if (!hierarchy[cluster][brand][group]) {
        hierarchy[cluster][brand][group] = {};
      }
      if (!hierarchy[cluster][brand][group][subgroup]) {
        hierarchy[cluster][brand][group][subgroup] = [];
      }
      hierarchy[cluster][brand][group][subgroup].push(product);
    });

    // Define columns
    worksheet.columns = [
      { header: 'Кластер', key: 'cluster', width: 30 },
      { header: 'Бренд', key: 'brand', width: 30 },
      { header: 'Группа', key: 'group', width: 30 },
      { header: 'Подгруппа', key: 'subgroup', width: 30 },
      { header: 'Артикул', key: 'articul', width: 20 },
      { header: 'Название', key: 'name', width: 45 },
      { header: 'Цена', key: 'price', width: 12 },
      { header: 'Себест.', key: 'cost', width: 12 },
      { header: 'Остаток FBO', key: 'stock_ozon', width: 12 },
      { header: 'Остаток FBO ₽', key: 'stock_ozon_value', width: 15 },
      { header: 'Заказы FBO', key: 'fbo', width: 12 },
      { header: 'Заказы FBO ₽', key: 'fbo_value', width: 15 },
      { header: 'Дни остатка', key: 'days_remaining', width: 12 }
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
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
    });

    let rowIndex = 2;

    // Calculate cluster totals for sorting
    const clusterTotals = {};
    Object.keys(hierarchy).forEach(cluster => {
      const clusterProducts = Object.values(hierarchy[cluster])
        .flatMap(brand => Object.values(brand))
        .flatMap(group => Object.values(group))
        .flatMap(products => products);
      const clusterStockValue = clusterProducts.reduce((sum, p) => {
        const cost = p.cost_1c || 0;
        return sum + (p.fbo_stock_count * cost);
      }, 0);
      clusterTotals[cluster] = clusterStockValue;
    });

    // Sort clusters by stock value (descending)
    const sortedClusters = Object.keys(hierarchy).sort((a, b) => clusterTotals[b] - clusterTotals[a]);

    // Iterate through hierarchy: Cluster → Brand → Group → Subgroup → Products
    sortedClusters.forEach(cluster => {
      // Calculate cluster totals
      const clusterProducts = Object.values(hierarchy[cluster])
        .flatMap(brand => Object.values(brand))
        .flatMap(group => Object.values(group))
        .flatMap(products => products);
      const clusterFbo = clusterProducts.reduce((sum, p) => sum + p.fbo_ordered_count, 0);
      const clusterStock = clusterProducts.reduce((sum, p) => sum + p.fbo_stock_count, 0);
      const clusterStockValue = clusterProducts.reduce((sum, p) => {
        const cost = p.cost_1c || 0;
        return sum + (p.fbo_stock_count * cost);
      }, 0);
      const clusterFboValue = clusterProducts.reduce((sum, p) => {
        const cost = p.cost_1c || 0;
        return sum + (p.fbo_ordered_count * cost);
      }, 0);
      const clusterDailyFboValue = clusterFboValue / daysCovered;
      const clusterDaysRemaining = clusterDailyFboValue > 0 ? clusterStockValue / clusterDailyFboValue : null;

      // Add cluster row
      const clusterRow = worksheet.getRow(rowIndex++);
      clusterRow.getCell(1).value = cluster;
      clusterRow.getCell(9).value = clusterStock;
      clusterRow.getCell(10).value = clusterStockValue;
      clusterRow.getCell(11).value = clusterFbo;
      clusterRow.getCell(12).value = clusterFboValue;
      clusterRow.getCell(13).value = clusterDaysRemaining;
      clusterRow.outlineLevel = 0;
      clusterRow.font = { bold: true, size: 13 };
      clusterRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD9D9D9' }
      };
      clusterRow.getCell(9).numFmt = '#,##0';
      clusterRow.getCell(10).numFmt = '#,##0.00';
      clusterRow.getCell(11).numFmt = '#,##0';
      clusterRow.getCell(12).numFmt = '#,##0.00';
      if (clusterDaysRemaining !== null) {
        clusterRow.getCell(13).numFmt = '#,##0.0';
      }

      Object.keys(hierarchy[cluster]).sort().forEach(brand => {
        // Calculate brand totals
        const brandProducts = Object.values(hierarchy[cluster][brand])
          .flatMap(group => Object.values(group))
          .flatMap(products => products);
        const brandFbo = brandProducts.reduce((sum, p) => sum + p.fbo_ordered_count, 0);
        const brandStock = brandProducts.reduce((sum, p) => sum + p.fbo_stock_count, 0);
        const brandStockValue = brandProducts.reduce((sum, p) => {
          const cost = p.cost_1c || 0;
          return sum + (p.fbo_stock_count * cost);
        }, 0);
        const brandFboValue = brandProducts.reduce((sum, p) => {
          const cost = p.cost_1c || 0;
          return sum + (p.fbo_ordered_count * cost);
        }, 0);
        const brandDailyFboValue = brandFboValue / daysCovered;
        const brandDaysRemaining = brandDailyFboValue > 0 ? brandStockValue / brandDailyFboValue : null;

        // Add brand row
        const brandRow = worksheet.getRow(rowIndex++);
        brandRow.getCell(2).value = brand;
        brandRow.getCell(9).value = brandStock;
        brandRow.getCell(10).value = brandStockValue;
        brandRow.getCell(11).value = brandFbo;
        brandRow.getCell(12).value = brandFboValue;
        brandRow.getCell(13).value = brandDaysRemaining;
        brandRow.outlineLevel = 1;
        brandRow.font = { bold: true, size: 12 };
        brandRow.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE7E6E6' }
        };
        brandRow.getCell(9).numFmt = '#,##0';
        brandRow.getCell(10).numFmt = '#,##0.00';
        brandRow.getCell(11).numFmt = '#,##0';
        brandRow.getCell(12).numFmt = '#,##0.00';
        if (brandDaysRemaining !== null) {
          brandRow.getCell(13).numFmt = '#,##0.0';
        }

        Object.keys(hierarchy[cluster][brand]).sort().forEach(group => {
          // Calculate group totals
          const groupProducts = Object.values(hierarchy[cluster][brand][group])
            .flatMap(products => products);
          const groupFbo = groupProducts.reduce((sum, p) => sum + p.fbo_ordered_count, 0);
          const groupStock = groupProducts.reduce((sum, p) => sum + p.fbo_stock_count, 0);
          const groupStockValue = groupProducts.reduce((sum, p) => {
            const cost = p.cost_1c || 0;
            return sum + (p.fbo_stock_count * cost);
          }, 0);
          const groupFboValue = groupProducts.reduce((sum, p) => {
            const cost = p.cost_1c || 0;
            return sum + (p.fbo_ordered_count * cost);
          }, 0);
          const groupDailyFboValue = groupFboValue / daysCovered;
          const groupDaysRemaining = groupDailyFboValue > 0 ? groupStockValue / groupDailyFboValue : null;

          // Add group row
          const groupRow = worksheet.getRow(rowIndex++);
          groupRow.getCell(3).value = group;
          groupRow.getCell(9).value = groupStock;
          groupRow.getCell(10).value = groupStockValue;
          groupRow.getCell(11).value = groupFbo;
          groupRow.getCell(12).value = groupFboValue;
          groupRow.getCell(13).value = groupDaysRemaining;
          groupRow.outlineLevel = 2;
          groupRow.font = { bold: true, size: 11 };
          groupRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF2F2F2' }
          };
          groupRow.getCell(9).numFmt = '#,##0';
          groupRow.getCell(10).numFmt = '#,##0.00';
          groupRow.getCell(11).numFmt = '#,##0';
          groupRow.getCell(12).numFmt = '#,##0.00';
          if (groupDaysRemaining !== null) {
            groupRow.getCell(13).numFmt = '#,##0.0';
          }

          Object.keys(hierarchy[cluster][brand][group]).sort().forEach(subgroup => {
            // Calculate subgroup totals
            const subgroupProducts = hierarchy[cluster][brand][group][subgroup];
            const subgroupFbo = subgroupProducts.reduce((sum, p) => sum + p.fbo_ordered_count, 0);
            const subgroupStock = subgroupProducts.reduce((sum, p) => sum + p.fbo_stock_count, 0);
            const subgroupStockValue = subgroupProducts.reduce((sum, p) => {
              const cost = p.cost_1c || 0;
              return sum + (p.fbo_stock_count * cost);
            }, 0);
            const subgroupFboValue = subgroupProducts.reduce((sum, p) => {
              const cost = p.cost_1c || 0;
              return sum + (p.fbo_ordered_count * cost);
            }, 0);
            const subgroupDailyFboValue = subgroupFboValue / daysCovered;
            const subgroupDaysRemaining = subgroupDailyFboValue > 0 ? subgroupStockValue / subgroupDailyFboValue : null;

            // Add subgroup row
            const subgroupRow = worksheet.getRow(rowIndex++);
            subgroupRow.getCell(4).value = subgroup;
            subgroupRow.getCell(9).value = subgroupStock;
            subgroupRow.getCell(10).value = subgroupStockValue;
            subgroupRow.getCell(11).value = subgroupFbo;
            subgroupRow.getCell(12).value = subgroupFboValue;
            subgroupRow.getCell(13).value = subgroupDaysRemaining;
            subgroupRow.outlineLevel = 3;
            subgroupRow.font = { bold: true, size: 10 };
            subgroupRow.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFFAFAFA' }
            };
            subgroupRow.getCell(9).numFmt = '#,##0';
            subgroupRow.getCell(10).numFmt = '#,##0.00';
            subgroupRow.getCell(11).numFmt = '#,##0';
            subgroupRow.getCell(12).numFmt = '#,##0.00';
            if (subgroupDaysRemaining !== null) {
              subgroupRow.getCell(13).numFmt = '#,##0.0';
            }

            // Add product rows
            hierarchy[cluster][brand][group][subgroup]
              .sort((a, b) => b.fbo_ordered_count - a.fbo_ordered_count)
              .forEach(product => {
                const cost = product.cost_1c || 0;
                const stockValue = product.fbo_stock_count * cost;
                const fboValue = product.fbo_ordered_count * cost;
                const dailyFboValue = fboValue / daysCovered;
                const daysRemaining = dailyFboValue > 0 ? stockValue / dailyFboValue : null;

                const productRow = worksheet.getRow(rowIndex++);
                productRow.getCell(1).value = cluster;
                productRow.getCell(2).value = brand;
                productRow.getCell(3).value = group;
                productRow.getCell(4).value = subgroup;
                productRow.getCell(5).value = product.offer_id;
                productRow.getCell(6).value = product.name || '';
                productRow.getCell(7).value = product.price_1c;
                productRow.getCell(8).value = product.cost_1c;
                productRow.getCell(9).value = product.fbo_stock_count;
                productRow.getCell(10).value = stockValue;
                productRow.getCell(11).value = product.fbo_ordered_count;
                productRow.getCell(12).value = fboValue;
                productRow.getCell(13).value = daysRemaining;
                productRow.outlineLevel = 4;

                // Format numbers
                if (product.price_1c !== null) {
                  productRow.getCell(7).numFmt = '#,##0.00';
                }
                if (product.cost_1c !== null) {
                  productRow.getCell(8).numFmt = '#,##0.00';
                }
                productRow.getCell(9).numFmt = '#,##0';
                productRow.getCell(10).numFmt = '#,##0.00';
                productRow.getCell(11).numFmt = '#,##0';
                productRow.getCell(12).numFmt = '#,##0.00';
                if (daysRemaining !== null) {
                  productRow.getCell(13).numFmt = '#,##0.0';
                }

                // Alternate row colors for products
                if (rowIndex % 2 === 0) {
                  productRow.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFFFFFFF' }
                  };
                }
              });
          });
        });
      });
    });

    // Freeze the header row and first column
    worksheet.views = [
      { state: 'frozen', xSplit: 0, ySplit: 1 }
    ];

    // Set outline properties to show expand/collapse buttons
    worksheet.properties.outlineLevelCol = 0;
    worksheet.properties.outlineLevelRow = 4;

    return await workbook.xlsx.writeBuffer();
  }

  // ==================== Ozon Weekly Sales Report ====================

  static async createOzonWeeklySalesReportBuffer(data) {
    const { weeks, items } = data;
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Отчёт');

    const PRODUCT_COLS = 6;
    const WEEK_COLS = 10;
    const totalCols = PRODUCT_COLS + weeks.length * WEEK_COLS;

    // Row 1: top-level merged headers (product section + per-week labels)
    const row1Placeholder = new Array(totalCols).fill('');
    worksheet.addRow(row1Placeholder);
    worksheet.getRow(1).height = 30;

    // Row 2: sub-headers
    const subHeaders = ['Артикул Родитель', 'Наименование родитель', 'Подгруппа', 'Бренд', 'Группа', 'Наименование'];
    const weekSubHeaders = [
      'Сумма заказов', 'Количество заказов шт', 'Выкупы сумма', 'Выкупы кол-во',
      '% сумма', '% выкупы', 'Остаток склад Смайл', 'Остаток FBO',
      'Средняя цена недели', 'Средняя цена недели %'
    ];
    const row2Data = [...subHeaders];
    weeks.forEach(() => row2Data.push(...weekSubHeaders));
    worksheet.addRow(row2Data);
    worksheet.getRow(2).height = 40;

    // Style row 1: product section header
    worksheet.mergeCells(1, 1, 1, PRODUCT_COLS);
    const prodCell = worksheet.getCell(1, 1);
    prodCell.value = 'Товар';
    prodCell.alignment = { horizontal: 'center', vertical: 'middle' };
    prodCell.font = { bold: true };
    prodCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDDDDD' } };

    // Style row 1: per-week merged headers
    weeks.forEach((week, i) => {
      const c1 = PRODUCT_COLS + 1 + i * WEEK_COLS;
      const c2 = c1 + WEEK_COLS - 1;
      worksheet.mergeCells(1, c1, 1, c2);
      const cell = worksheet.getCell(1, c1);
      cell.value = week.label;
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.font = { bold: true };
      cell.fill = {
        type: 'pattern', pattern: 'solid',
        fgColor: { argb: i % 2 === 0 ? 'FFFFF2CC' : 'FFE8F5E8' }
      };
    });

    // Style row 2: sub-headers
    const row2 = worksheet.getRow(2);
    row2.font = { bold: true };
    row2.eachCell((cell, col) => {
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
      if (col <= PRODUCT_COLS) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD0D0D0' } };
      } else {
        const weekIndex = Math.floor((col - PRODUCT_COLS - 1) / WEEK_COLS);
        cell.fill = {
          type: 'pattern', pattern: 'solid',
          fgColor: { argb: weekIndex % 2 === 0 ? 'FFFFF8DC' : 'FFF0FFF0' }
        };
      }
    });

    // Data rows
    items.forEach((item, rowIdx) => {
      const rowValues = [
        item.parent_article,
        item.parent_name,
        item.subgroup,
        item.brand,
        item.group,
        item.name
      ];

      item.weeks.forEach(w => {
        rowValues.push(
          w.order_amount || null,
          w.order_qty || null,
          w.buyout_amount || null,
          w.buyout_qty || null,
          w.order_amount_pct,
          w.buyout_amount_pct,
          w.smile_stock || null,
          w.fbo_stock || null,
          w.avg_week_price,
          w.avg_week_price_pct
        );
      });

      const dataRow = worksheet.addRow(rowValues);

      // Alternate row background
      const rowBg = rowIdx % 2 === 0 ? 'FFFFFFFF' : 'FFF7F7F7';
      dataRow.eachCell({ includeEmpty: true }, cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
      });

      // Number formats for week columns
      item.weeks.forEach((w, i) => {
        const base = PRODUCT_COLS + 1 + i * WEEK_COLS;
        dataRow.getCell(base + 0).numFmt = '#,##0';   // Сумма заказов
        dataRow.getCell(base + 1).numFmt = '#,##0';   // Количество заказов шт
        dataRow.getCell(base + 2).numFmt = '#,##0';   // Выкупы сумма
        dataRow.getCell(base + 3).numFmt = '#,##0';   // Выкупы кол-во
        dataRow.getCell(base + 4).numFmt = '0%';      // % сумма
        dataRow.getCell(base + 5).numFmt = '0%';      // % выкупы
        dataRow.getCell(base + 6).numFmt = '#,##0';   // Остаток Смайл
        dataRow.getCell(base + 7).numFmt = '#,##0';   // Остаток FBO
        dataRow.getCell(base + 8).numFmt = '#,##0';   // Средняя цена
        dataRow.getCell(base + 9).numFmt = '0%';      // Средняя цена %
      });
    });

    // Column widths
    worksheet.getColumn(1).width = 15;  // Артикул Родитель
    worksheet.getColumn(2).width = 30;  // Наименование родитель
    worksheet.getColumn(3).width = 20;  // Подгруппа
    worksheet.getColumn(4).width = 12;  // Бренд
    worksheet.getColumn(5).width = 25;  // Группа
    worksheet.getColumn(6).width = 35;  // Наименование
    for (let c = PRODUCT_COLS + 1; c <= totalCols; c++) {
      worksheet.getColumn(c).width = 11;
    }

    // Freeze first 2 header rows and first 6 product columns
    worksheet.views = [{ state: 'frozen', xSplit: PRODUCT_COLS, ySplit: 2 }];

    // Autofilter on sub-header row
    worksheet.autoFilter = {
      from: { row: 2, column: 1 },
      to: { row: 2, column: totalCols }
    };

    return await workbook.xlsx.writeBuffer();
  }
}

module.exports = Excel;