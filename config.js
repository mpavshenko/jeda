require('dotenv').config();

const ozonConfig = {
  baseURL: process.env.OZON_BASE_URL || 'https://api-seller.ozon.ru',
  clientId: process.env.OZON_CLIENT_ID,
  apiKey: process.env.OZON_API_KEY,

  // Rate limiting
  requestDelay: 100, // ms between requests
  maxRetries: 3,

  // Business logic constants
  FBO_STOCK_SUPPLY_DAYS: 28,
  FBO_SAFETY_STOCK_DAYS: 5,
  DAYS_COVERED: 30, // Default period for sales analysis

  // Delivery days by cluster
  deliveryDays: {
    'Москва': 10,
    'МО': 10,
    'Дальние регионы': 10,
    'Санкт-Петербург': 7,
    'СЗО': 7,
    'Урал': 10,
    'Дальний Восток': 30,
    'Казань': 15
  }
};

module.exports = ozonConfig;