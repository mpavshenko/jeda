const express = require('express');
const cron = require('node-cron');
const cronstrue = require('cronstrue');
const path = require('path');
const serveIndex = require('serve-index');
const config = require('./config');
const { fulfillmentReport } = require('./ffl');
const { version } = require('./package.json');

const app = express();
const PORT = process.env.PORT || 3000;

// Schedule report generation
cron.schedule(config.cronSchedule, async () => {
  console.log(`Running scheduled fulfillment report...`);
  try {
    await fulfillmentReport();
    console.log(`Report generation completed successfully`);
  } catch (error) {
    console.error(`Report generation failed:`, error);
  }
});

// Serve static files from reports directory (for browsing)
const reportsPath = path.join(__dirname, 'reports');
app.use('/reports', express.static(reportsPath));
app.use('/reports', serveIndex(reportsPath, {
  icons: true,
  view: 'details'
}));

// Serve logs directory (for browsing)
const logsPath = path.join(__dirname, 'logs');
app.use('/logs', express.static(logsPath));
app.use('/logs', serveIndex(logsPath, {
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
  const cronDescription = cronstrue.toString(config.cronSchedule, { use24HourTimeFormat: true, verbose: true });
  console.log(`Scheduled report generation: "${config.cronSchedule}" => ${cronDescription}`);
});
