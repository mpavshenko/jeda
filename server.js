require('dotenv').config();

const express = require('express');
const cron = require('node-cron');
const cronstrue = require('cronstrue');
const path = require('path');
const serveIndex = require('serve-index');
const basicAuth = require('express-basic-auth');
const { ozonConfig, wbConfig } = require('./config');
const { fulfillmentReport } = require('./ffl');
const { fulfillmentReport: wbFulfillmentReport } = require('./ffl-wb');
const { managementReport } = require('./mgr');
const { managementReport: wbManagementReport } = require('./mgr-wb');
const { version } = require('./package.json');

const app = express();
const PORT = process.env.PORT || 3000;

// Basic auth middleware for protected routes
const auth = basicAuth({
  users: {
    [process.env.BASIC_AUTH_USER || 'jeda']: process.env.BASIC_AUTH_PASSWORD || '123456'
  },
  challenge: true,
  realm: 'Jeda Seller Reports'
});

// Schedule Ozon fulfillment report generation
cron.schedule(ozonConfig.cronSchedule, async () => {
  console.log(`Running scheduled Ozon fulfillment report...`);
  try {
    // Feb 10th:
    // 1. Горизонт планирования (на сколько везём) с 28 дней до 14 дней
    // 2. Срок доставки с 14 дней до 10 дней
    // Apr 1st:
    // вернуть горизонт планирования с 14 на 28 дней
    await fulfillmentReport(28, 28, 10);
    console.log(`Ozon fulfillment report generation completed successfully`);
  } catch (error) {
    console.error(`Ozon fulfillment report generation failed:`, error.message || error);
  }

  // Run management report after fulfillment report
  console.log(`Running Ozon management report...`);
  try {
    await managementReport(28);
    console.log(`Ozon management report generation completed successfully`);
  } catch (error) {
    console.error(`Ozon management report generation failed:`, error.message || error);
  }
});

// Schedule WB report generation
cron.schedule(wbConfig.cronSchedule, async () => {
  console.log(`Running scheduled WB fulfillment report...`);
  try {
    // Feb 10th:
    // 1. Горизонт планирования (на сколько везём) с 28 дней до 14 дней
    // 2. Срок доставки с 14 дней до 10 дней
    await wbFulfillmentReport(28, 14, 10);
    console.log(`WB fulfillment report generation completed successfully`);
  } catch (error) {
    console.error(`WB fulfillment report generation failed:`, error.message || error);
  }

  // Run WB management report after fulfillment report
  console.log(`Running WB management report...`);
  try {
    await wbManagementReport(28);
    console.log(`WB management report generation completed successfully`);
  } catch (error) {
    console.error(`WB management report generation failed:`, error.message || error);
  }
});

// Serve static files from reports directory (for browsing) - with auth
const reportsPath = path.join(__dirname, 'reports');
app.use('/reports', auth, express.static(reportsPath));
app.use('/reports', auth, serveIndex(reportsPath, {
  icons: true,
  view: 'details'
}));

// Serve logs directory (for browsing) - with auth
const logsPath = path.join(__dirname, 'logs');
app.use('/logs', auth, express.static(logsPath));
app.use('/logs', auth, serveIndex(logsPath, {
  icons: true,
  view: 'details'
}));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: version,
    timestamp: new Date().toISOString()
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Jeda Seller Fulfillment Report Service',
    version: version,
    endpoints: {
      health: 'GET /health',
      reports: '/reports/*',
      logs: '/logs/*'
    }
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  const ozonCronDescription = cronstrue.toString(ozonConfig.cronSchedule, { use24HourTimeFormat: true, verbose: true });
  console.log(`Scheduled Ozon reports (fulfillment + management): "${ozonConfig.cronSchedule}" => ${ozonCronDescription}`);
  const wbCronDescription = cronstrue.toString(wbConfig.cronSchedule, { use24HourTimeFormat: true, verbose: true });
  console.log(`Scheduled WB reports (fulfillment + management): "${wbConfig.cronSchedule}" => ${wbCronDescription}`);
});
