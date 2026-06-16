// Excel builder for Ozon Weekly Sales Report.
// Self-contained new module — does not modify other excel services.
// Produces an XLSX structurally compatible with `weeks-report.xlsx`:
//   - 6 product columns (Артикул Родитель, Наименование родитель, Подгруппа,
//     Бренд, Группа, Наименование)
//   - Per-week blocks of 10 columns (merged header row + sub-header row)
//   - Freeze panes, auto filter, readable widths and number formats.

const ExcelJS = require('exceljs');

const PRODUCT_COLUMNS = [
  { header: 'Артикул Родитель', key: 'parent_article', width: 18 },
  { header: 'Наименование родитель', key: 'parent_name', width: 32 },
  { header: 'Подгруппа', key: 'subgroup', width: 14 },
  { header: 'Бренд', key: 'brand', width: 14 },
  { header: 'Группа', key: 'group', width: 24 },
  { header: 'Наименование', key: 'name', width: 36 }
];

// Order must match the spec / weeks-report.xlsx.
const WEEK_COLUMNS = [
  { header: 'Сумма заказов',         key: 'order_amount',        width: 12, fmt: '#,##0' },
  { header: 'Количество заказов шт', key: 'order_qty',           width: 10, fmt: '#,##0' },
  { header: 'Выкупы сумма',          key: 'buyout_amount',       width: 12, fmt: '#,##0' },
  { header: 'Выкупы кол-во',         key: 'buyout_qty',          width: 10, fmt: '#,##0' },
  { header: '% сумма',               key: 'order_amount_pct',    width: 9,  fmt: '0%' },
  { header: '% выкупы',              key: 'buyout_amount_pct',   width: 9,  fmt: '0%' },
  { header: 'Остаток склад Смайл',   key: 'smile_stock',         width: 12, fmt: '#,##0' },
  { header: 'Остаток FBO',           key: 'fbo_stock',            width: 12, fmt: '#,##0' },
  { header: 'Средняя цена недели',   key: 'avg_week_price',       width: 14, fmt: '#,##0.00' },
  { header: 'Средняя цена недели %', key: 'avg_week_price_pct',   width: 12, fmt: '0%' }
];

function colLetter(n) {
  // 1 -> A, 27 -> AA
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * Build a workbook buffer for the Ozon Weekly Sales Report.
 *
 * @param {Object} data  output of calculateWeeklySalesData()
 * @param {Object} [options]
 * @param {string} [options.buyoutRule]          Text describing buyout filter (for Meta sheet)
 * @param {string} [options.snapshotDisclosure]  Text describing stock snapshot limitation
 * @returns {Promise<Buffer>}
 */
async function createOzonWeeklySalesReportBuffer(data, options = {}) {
  const { weeks = [], items = [] } = data || {};

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Jeda';
  workbook.created = new Date();

  const ws = workbook.addWorksheet('Отчёт', {
    views: [{ state: 'frozen', xSplit: PRODUCT_COLUMNS.length, ySplit: 2 }]
  });

  const weekBlockSize = WEEK_COLUMNS.length;
  const totalCols = PRODUCT_COLUMNS.length + weeks.length * weekBlockSize;

  // --- Row 1: week group header (merged per block) ----------------------------
  const row1 = ws.getRow(1);
  weeks.forEach((w, wi) => {
    const startCol = PRODUCT_COLUMNS.length + 1 + wi * weekBlockSize;
    const endCol = startCol + weekBlockSize - 1;
    const cell = row1.getCell(startCol);
    cell.value = w.label;
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.font = { bold: true };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE8EEF7' }
    };
    ws.mergeCells(1, startCol, 1, endCol);
  });
  row1.height = 20;

  // --- Row 2: sub-headers (product columns + per-week columns) ----------------
  const row2 = ws.getRow(2);
  PRODUCT_COLUMNS.forEach((pc, i) => {
    const cell = row2.getCell(i + 1);
    cell.value = pc.header;
    cell.font = { bold: true };
    cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF5F5F5' }
    };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFBFBFBF' } } };
  });

  weeks.forEach((_, wi) => {
    WEEK_COLUMNS.forEach((wc, ci) => {
      const col = PRODUCT_COLUMNS.length + 1 + wi * weekBlockSize + ci;
      const cell = row2.getCell(col);
      cell.value = wc.header;
      cell.font = { bold: true };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF5F5F5' }
      };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFBFBFBF' } } };
    });
  });
  row2.height = 32;

  // --- Column widths ----------------------------------------------------------
  PRODUCT_COLUMNS.forEach((pc, i) => {
    ws.getColumn(i + 1).width = pc.width;
  });
  weeks.forEach((_, wi) => {
    WEEK_COLUMNS.forEach((wc, ci) => {
      const col = PRODUCT_COLUMNS.length + 1 + wi * weekBlockSize + ci;
      ws.getColumn(col).width = wc.width;
    });
  });

  // --- Data rows --------------------------------------------------------------
  items.forEach(item => {
    const row = ws.addRow([]);

    PRODUCT_COLUMNS.forEach((pc, i) => {
      row.getCell(i + 1).value = item[pc.key] != null ? item[pc.key] : '';
    });

    (item.weeks || []).forEach((wdata, wi) => {
      WEEK_COLUMNS.forEach((wc, ci) => {
        const col = PRODUCT_COLUMNS.length + 1 + wi * weekBlockSize + ci;
        const cell = row.getCell(col);
        let v = wdata ? wdata[wc.key] : null;
        if (v === undefined) v = null;
        cell.value = v;
        if (wc.fmt) cell.numFmt = wc.fmt;
        if (typeof v === 'number') {
          cell.alignment = { horizontal: 'right' };
        }
      });
    });
  });

  // --- Auto filter on sub-header row ------------------------------------------
  ws.autoFilter = {
    from: { row: 2, column: 1 },
    to:   { row: 2, column: totalCols }
  };

  // --- Meta sheet with documentation ------------------------------------------
  const meta = workbook.addWorksheet('Meta');
  meta.columns = [
    { header: 'Поле', key: 'k', width: 28 },
    { header: 'Значение', key: 'v', width: 80 }
  ];
  meta.getRow(1).font = { bold: true };
  const metaRows = [
    ['Отчёт', 'Ozon Weekly Sales Report'],
    ['Сгенерирован', new Date().toISOString()],
    ['Количество недель', weeks.length],
    ['Период с', weeks.length ? weeks[0].fromDate : ''],
    ['Период по', weeks.length ? weeks[weeks.length - 1].toDate : ''],
    ['Определение «выкуп»', options.buyoutRule || "Ozon FBO posting.status === 'delivered'"],
    ['Ограничение по остаткам', options.snapshotDisclosure ||
      'Нет исторических weekly snapshots: текущие остатки Смайл/FBO применены ко всем неделям'],
    ['Правило parent_article', 'Базовый артикул без размерного суффикса (-S/-M/-L/-XL/-XXL/...)']
  ];
  metaRows.forEach(([k, v]) => {
    meta.addRow({ k, v });
  });

  const buf = await workbook.xlsx.writeBuffer();
  return Buffer.from(buf);
}

module.exports = {
  createOzonWeeklySalesReportBuffer,
  // exported in case other modules want to reuse the layout
  PRODUCT_COLUMNS,
  WEEK_COLUMNS,
  colLetter
};
