const axios = require('axios');
const { formatRFC3339 } = require('../utils/dates');
const { wbConfig } = require('../config');

class WB {
  constructor() {
    this.client = axios.create({
      baseURL: 'https://common-api.wildberries.ru',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${wbConfig.apiToken}`
      }
    });

    this.contentClient = axios.create({
      baseURL: 'https://content-api.wildberries.ru',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${wbConfig.apiToken}`
      }
    });

    this.suppliersClient = axios.create({
      baseURL: 'https://suppliers-api.wildberries.ru',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${wbConfig.apiToken}`
      }
    });

    this.statisticsClient = axios.create({
      baseURL: 'https://statistics-api.wildberries.ru',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': wbConfig.apiToken
      }
    });
  }

  async ping() {
    try {
      const response = await this.client.get('/ping');
      return response.data;
    } catch (error) {
      console.error('WB API Error:', error.response?.data || error.message);
      throw error;
    }
  }

  /*

  /content/v2/get/cards/list

  returns:

  {
  "cards": [
        {
          "nmID": 12345678,
          "imtID": 123654789,
          "nmUUID": "01bda0b1-5c0b-736c-b2be-d0a6543e9be",
          "subjectID": 7771,
          "subjectName": "AKF системы",
          "vendorCode": "wb7f6mumjr1",
          "brand": "Тест",
          "title": "Тест-система",
          "description": "Тестовое описание",
          "needKiz": false,
          "photos": [],
          "video": "https://videonme-basket-12.wbbasket.ru/vol137/part22557/225577433/hls/1440p/index.m3u8",
          "wholesale": {
            "enabled": true,
            "quantum": 112
          },
          "dimensions": {
            "length": 55,
            "width": 40,
            "height": 15,
            "weightBrutto": 6.24,
            "isValid": false
          },
          "characteristics": [
            {
              "id": 14177449,
              "name": "Цвет",
              "value": [
                "красно-сиреневый"
              ]
            }
          ],
          "sizes": [
            {
              "chrtID": 316399238,
              "techSize": "0",
              "skus": [
                "987456321654"
              ]
            }
          ],
          "tags": [
            {
              "id": 592569,
              "name": "Популярный",
              "color": "D1CFD7"
            }
          ],
          "createdAt": "2023-12-06T11:17:00.96577Z",
          "updatedAt": "2023-12-06T11:17:00.96577Z"
        }
      ],
      "cursor": {
        "updatedAt": "2023-12-06T11:17:00.96577Z",
        "nmID": 123654123,
        "total": 1
      }
    }
  */

  async getAllCards() {
    const allProducts = [];
    let cursor = {
      limit: 100
    };
    let hasMore = true;

    while (hasMore) {
      try {
        const requestBody = {
          settings: {
            cursor,
            filter: {
              withPhoto: -1
            }
          }
        };

        console.log(`Fetching products batch with cursor:`, JSON.stringify(cursor));

        const response = await this.contentClient.post('/content/v2/get/cards/list', requestBody);
        const result = response.data || {};
        const cards = result.cards || [];

        if (cards.length > 0) {
          allProducts.push(...cards);
          console.log(`Fetched ${cards.length} products. Total so far: ${allProducts.length}`);

          // Check if there's more data (when we get less than limit, we're done)
          if (cards.length < cursor.limit) {
            hasMore = false;
          } else {
            // Update cursor with last item's data for next iteration
            const lastCard = cards[cards.length - 1];
            cursor = {
              limit: 100,
              updatedAt: lastCard.updatedAt,
              nmID: lastCard.nmID
            };
          }
        } else {
          hasMore = false;
        }
      } catch (error) {
        console.error('WB API Error:', error.response?.data || error.message);
        throw error;
      }
    }

    console.log(`Successfully fetched all ${allProducts.length} products`);
    return allProducts;
  }

  /* Result example:
  [{
    article: 'D81703-XXL',
    name: 'Куртка рабочая 3 в 1 демисезонная с жилеткой'
  }]
  */
  extractProductsFromCards(cards) {
    return cards.flatMap(card =>
      card.sizes.map(size => (
        {
          article: card.sizes.length === 1
            ? card.vendorCode
            : `${card.vendorCode}-${size.techSize}`,
          name: card.title
        }
      )));
  }

  getTokenInfo() {
    try {
      const token = wbConfig.apiToken;
      if (!token) {
        throw new Error('WB_API_TOKEN not found in configuration');
      }

      // Decode JWT token (header.payload.signature)
      const parts = token.split('.');
      if (parts.length !== 3) {
        throw new Error('Invalid JWT token format');
      }

      // Decode payload (second part)
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());

      // Decode header
      const header = JSON.parse(Buffer.from(parts[0], 'base64').toString());

      return {
        header,
        payload,
        scopes: this.decodeScopes(payload.s || 0),
        expiresAt: payload.exp ? new Date(payload.exp * 1000).toISOString() : 'N/A',
        userId: payload.uid,
        sellerId: payload.oid
      };
    } catch (error) {
      console.error('Error decoding token:', error.message);
      throw error;
    }
  }

  decodeScopes(scopeMask) {
    const scopeMap = {
      1: 'Content (Контент)',
      2: 'Analytics (Аналитика)',
      3: 'Prices & Discounts (Цены и скидки)',
      4: 'Marketplace (Маркетплейс)',
      5: 'Statistics (Статистика)',
      6: 'Promotions (Продвижение)',
      7: 'Recommendations (Рекомендации)',
      8: 'Questions & Reviews (Вопросы и отзывы)',
      9: 'Returns (Возвраты)',
      10: 'Chat (Чат с покупателями)',
      30: 'Read-only mode (Режим чтения)'
    };

    const scopes = [];
    for (const [bit, description] of Object.entries(scopeMap)) {
      if (scopeMask & (1 << (parseInt(bit) - 1))) {
        scopes.push(description);
      }
    }

    return scopes.length > 0 ? scopes : ['No scopes detected'];
  }

  /* Get all orders (both FBS and FBW) from statistics API with warehouse separation
     This is the recommended method for reporting as it includes all order types.
     Result example:
     [{
        date: '2025-09-23T22:07:10',
        warehouseName: 'Тула',
        warehouseType: 'Склад WB',
        supplierArticle: 'D81250',
        techSize: 'XL',
        isCancel: false
     }]
  */
  async getAllOrders(dateFrom, dateTo) {
    const allOrders = [];
    let currentDateFrom = dateFrom;
    const dateToRFC = formatRFC3339(dateTo);

    while (true) {
      const dateFromRFC = formatRFC3339(currentDateFrom);
      console.log(`Fetching orders from statistics API starting at: ${dateFromRFC}`);

      try {
        const response = await this.statisticsClient.get('/api/v1/supplier/orders', {
          params: {
            dateFrom: dateFromRFC,
            flag: 0
          }
        });

        const orders = response.data || [];

        if (orders.length === 0) {
          console.log('No more orders to fetch');
          break;
        }

        // Filter orders to only include those before dateTo
        const filteredOrders = orders.filter(order => {
          const orderDate = new Date(order.lastChangeDate);
          return orderDate <= dateTo;
        });

        // Transform to only include used fields
        const transformedOrders = filteredOrders.map(order => ({
          date: order.date,
          // lastChangeDate: order.lastChangeDate,
          warehouseName: order.warehouseName,
          warehouseType: order.warehouseType,
          supplierArticle: order.supplierArticle,
          // nmId: order.nmId,
          // barcode: order.barcode,
          // category: order.category,
          // subject: order.subject,
          // brand: order.brand,
          techSize: order.techSize,
          // totalPrice: order.totalPrice,
          // discountPercent: order.discountPercent,
          // priceWithDisc: order.priceWithDisc,
          isCancel: order.isCancel,
          // cancelDate: order.cancelDate
        }));

        allOrders.push(...transformedOrders);
        console.log(`Fetched ${filteredOrders.length} orders. Total so far: ${allOrders.length}`);

        // Check if we've reached dateTo
        if (filteredOrders.length < orders.length) {
          console.log('Reached dateTo boundary');
          break;
        }

        // Use lastChangeDate from the last order for next iteration
        const lastOrder = orders[orders.length - 1];
        const lastChangeDate = new Date(lastOrder.lastChangeDate);

        // Add 1 millisecond to avoid getting the same order again
        currentDateFrom = new Date(lastChangeDate.getTime() + 1);

        // If we've passed dateTo, stop
        if (currentDateFrom > dateTo) {
          break;
        }

        // Rate limiting: 1 request per minute
        if (orders.length > 0) {
          console.log('Waiting 60 seconds due to rate limit...');
          await new Promise(resolve => setTimeout(resolve, 60000));
        }

      } catch (error) {
        console.error(`Error fetching orders from statistics API:`, error.response?.data || error.message);
        throw error;
      }
    }

    console.log(`Successfully fetched all ${allOrders.length} orders from statistics API`);
    return allOrders;
  }

  /* Create a map from warehouse name to cluster name
     Result example:
     {
       "Пушкино": "Центральный",
       "Тула": "Центральный",
       "Казань": "Приволжский",
       "Минск": "Беларусь"
     }
  */
  createWarehouseToClusterMap() {
    const map = {};

    Object.entries(wbConfig.clusters).forEach(([clusterName, warehouses]) => {
      warehouses.forEach(warehouseName => {
        map[warehouseName] = clusterName;
      });
    });

    return map;
  }

  /* Enrich orders with cluster information
     Input: orders from getAllOrders
     Output: orders with cluster field added
     Result example:
     [{
        date: '2025-09-23T22:07:10',
        lastChangeDate: '2025-09-24T00:14:58',
        warehouseName: 'Тула',
        warehouseType: 'Склад WB',
        supplierArticle: 'D81250',
        techSize: 'XL',
        isCancel: false,
        cluster: 'Центральный'
      }]
  */
  enrichOrdersWithClusters(orders) {
    const warehouseToCluster = this.createWarehouseToClusterMap();

    return orders.map(order => ({
      ...order,
      cluster: warehouseToCluster[order.warehouseName] || 'Unknown'
    }));
  }

  /* Get current stocks using Statistics API
     Returns real-time stock data updated every 30 minutes
     Includes warehouse location, quantities, and in-transit information

     @param {boolean} debug - If true, fetches only first batch without pagination/rate limiting

     Result example:
     [{
       "lastChangeDate": "2023-07-05T11:13:35",
       "warehouseName": "Краснодар",
       "supplierArticle": "D81250",
       "nmId": 1439871458,
       "barcode": "2037401340280",
       "quantity": 33,
       "inWayToClient": 1,
       "inWayFromClient": 0,
       "quantityFull": 34,
       "category": "Посуда и инвентарь",
       "subject": "Формы для запекания",
       "brand": "X",
       "techSize": "XL",
       "Price": 185,
       "Discount": 0,
       "isSupply": true,
       "isRealization": false,
       "SCCode": "Tech"
     }]
  */
  async getStocks(debug = false) {
    const allStocks = [];
    let dateFrom = '2019-06-20';  // Earliest possible date to get all stocks
    let hasMore = true;

    while (hasMore) {
      console.log(`Fetching stocks from dateFrom: ${dateFrom}`);

      try {
        const response = await this.statisticsClient.get('/api/v1/supplier/stocks', {
          params: { dateFrom }
        });

        const stocks = response.data || [];

        if (stocks.length > 0) {
          allStocks.push(...stocks);
          console.log(`Fetched ${stocks.length} stock records. Total so far: ${allStocks.length}`);

          // In debug mode, stop after first request
          if (debug) {
            console.log('Debug mode: stopping after first request');
            hasMore = false;
            break;
          }

          // Use lastChangeDate of the last item for next request
          const lastStock = stocks[stocks.length - 1];
          dateFrom = lastStock.lastChangeDate;
        } else {
          // Empty array means all stocks have been retrieved
          hasMore = false;
        }

        // Rate limiting: 1 request per minute (skip in debug mode)
        if (hasMore && !debug) {
          console.log('Waiting 60 seconds due to rate limit...');
          await new Promise(resolve => setTimeout(resolve, 60000));
        }
      } catch (error) {
        console.error(`Error fetching stocks from ${dateFrom}:`, error.response?.data || error.message);
        throw error;
      }
    }

    console.log(`Successfully fetched ${allStocks.length} stock records${debug ? ' (debug mode)' : ''}`);
    return allStocks;
  }
}

module.exports = WB;
