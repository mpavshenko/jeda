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

// Schedule Ozon report generation
cron.schedule(ozonConfig.cronSchedule, async () => {
  console.log(`Running scheduled Ozon fulfillment report...`);
  try {
    await fulfillmentReport();
    console.log(`Ozon report generation completed successfully`);
  } catch (error) {
    console.error(`Ozon report generation failed:`, error.message || error);
  }
});

// Schedule WB report generation
cron.schedule(wbConfig.cronSchedule, async () => {
  console.log(`Running scheduled WB fulfillment report...`);
  try {
    await wbFulfillmentReport();
    console.log(`WB report generation completed successfully`);
  } catch (error) {
    console.error(`WB report generation failed:`, error.message || error);
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
  console.log(`Scheduled Ozon report: "${ozonConfig.cronSchedule}" => ${ozonCronDescription}`);
  const wbCronDescription = cronstrue.toString(wbConfig.cronSchedule, { use24HourTimeFormat: true, verbose: true });
  console.log(`Scheduled WB report: "${wbConfig.cronSchedule}" => ${wbCronDescription}`);
});
