require('dotenv').config();

const ozonConfig = {
  baseURL: process.env.OZON_BASE_URL || 'https://api-seller.ozon.ru',
  clientId: process.env.OZON_CLIENT_ID,
  apiKey: process.env.OZON_API_KEY,

  // Rate limiting
  requestDelay: 500, // ms between requests
  maxRetries: 3,

  // Business logic constants
  FBO_STOCK_SUPPLY_DAYS: 28,
  FBO_SAFETY_STOCK_DAYS: 5,
  DAYS_COVERED: 30, // Default period for sales analysis

  // Delivery days by cluster
  deliveryDays: {
    "Москва, МО и Дальние регионы": 10,
    "Санкт-Петербург и СЗО": 7,
    "Урал": 10,
    "Дальний Восток": 30,
    "Казань": 15,
    "Уфа": 7,
    "Самара": 7,
    "Красноярск": 50,
    "Воронеж": 7,
    "Калининград": 10,
    "Тюмень": 10,
    "Кавказ": 7,
    "Ярославль": 16,
    "Сибирь": 10,
    "Юг": 7,
    "Саратов": 10
  }
};

module.exports = ozonConfig;