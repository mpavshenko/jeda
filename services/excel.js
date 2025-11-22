const XLSX = require('xlsx');
const ExcelJS = require('exceljs');
const { ozonConfig, wbConfig } = require('../config');

// Cluster order from config.js deliveryDays
const CLUSTER_ORDER = Object.keys(ozonConfig.deliveryDays);

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
      headerRow1.push(cluster, '', '', '', '', ''); // Cluster spans 6 columns
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
    worksheet.getColumn(2).width = 15; // Штрихкод
    worksheet.getColumn(3).width = 45; // Название
    worksheet.getColumn(4).width = 10; // Цена
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
}

module.exports = Excel;