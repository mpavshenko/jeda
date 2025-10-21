const axios = require('axios');

class WB {
  constructor() {
    this.client = axios.create({
      baseURL: 'https://common-api.wildberries.ru',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.WB_API_TOKEN}`
      }
    });

    this.contentClient = axios.create({
      baseURL: 'https://content-api.wildberries.ru',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.WB_API_TOKEN}`
      }
    });

    this.suppliersClient = axios.create({
      baseURL: 'https://suppliers-api.wildberries.ru',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.WB_API_TOKEN}`
      }
    });

    this.statisticsClient = axios.create({
      baseURL: 'https://statistics-api.wildberries.ru',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': process.env.WB_API_TOKEN
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

  async getAllProducts(options = {}) {
    try {
      const {
        limit = 100,
        offset = 0,
        sortColumn = 'updateAt',
        sortOrder = 'asc',
        withPhoto = -1
      } = options;

      const requestBody = {
        settings: {
          cursor: {
            limit,
            updatedAt: offset,
            nmID: 0
          },
          filter: {
            textSearch: '',
            withPhoto
          }
        },
        sort: {
          column: sortColumn,
          order: sortOrder
        }
      };

      const response = await this.contentClient.post('/content/v2/get/cards/list', requestBody);
      return response.data;
    } catch (error) {
      console.error('WB API Error:', error.response?.data || error.message);
      throw error;
    }
  }

  getTokenInfo() {
    try {
      const token = process.env.WB_API_TOKEN;
      if (!token) {
        throw new Error('WB_API_TOKEN not found in environment variables');
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

  /* Get all FBS orders for a date range
     Result example:
     [{
       id: 12345678,
       article: "D81140-L",
       nmId: 98765432,
       warehouseId: 507,
       offices: ["Коледино"],
       createdAt: "2024-10-15T10:30:00Z",
       price: 2500
     }]
  */
  async getAllFbsOrders(dateFrom, dateTo) {
    const allOrders = [];
    let next = 0;
    const limit = 1000;
    let hasMore = true;

    // Convert Date objects to Unix timestamps
    const dateFromTs = Math.floor(dateFrom.getTime() / 1000);
    const dateToTs = Math.floor(dateTo.getTime() / 1000);

    while (hasMore) {
      console.log(`Fetching FBS orders batch with next: ${next}`);

      try {
        const response = await this.suppliersClient.get('/api/v3/orders', {
          params: {
            limit,
            next,
            dateFrom: dateFromTs,
            dateTo: dateToTs
          }
        });

        const result = response.data || {};
        const orders = result.orders || [];

        if (orders.length > 0) {
          // Transform to only include used fields
          const transformedOrders = orders.map(order => ({
            id: order.id,
            article: order.article,
            nmId: order.nmId,
            warehouseId: order.warehouseId,
            officeId: order.officeId,
            offices: order.offices || [],
            createdAt: order.createdAt,
            price: order.price,
            skus: order.skus || []
          }));

          allOrders.push(...transformedOrders);
          console.log(`Fetched ${orders.length} FBS orders. Total so far: ${allOrders.length}`);

          // Check if there's more data
          if (result.next && result.next > 0) {
            next = result.next;
          } else {
            hasMore = false;
          }
        } else {
          hasMore = false;
        }
      } catch (error) {
        console.error(`Error fetching FBS orders at next ${next}:`, error.response?.data || error.message);
        throw error;
      }
    }

    console.log(`Successfully fetched all ${allOrders.length} FBS orders`);
    return allOrders;
  }

  /* Get all orders (both FBS and FBW) from statistics API with warehouse separation
     This is the recommended method for reporting as it includes all order types.
     Result example:
     [{
       date: "2024-10-15T10:30:00Z",
       lastChangeDate: "2024-10-15T12:00:00Z",
       warehouseName: "Коледино",
       warehouseType: "FBW",
       supplierArticle: "D81140-L",
       nmId: 98765432,
       barcode: "1234567890123",
       quantity: 1,
       totalPrice: 2500,
       discountPercent: 10,
       isCancel: false
     }]
  */
  async getAllOrders(dateFrom, dateTo) {
    const allOrders = [];
    let currentDateFrom = dateFrom;

    // Format date to RFC3339 (YYYY-MM-DDTHH:MM:SS)
    const formatRFC3339 = (date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      const seconds = String(date.getSeconds()).padStart(2, '0');
      return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
    };

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
          lastChangeDate: order.lastChangeDate,
          warehouseName: order.warehouseName,
          warehouseType: order.warehouseType,
          supplierArticle: order.supplierArticle,
          nmId: order.nmId,
          barcode: order.barcode,
          category: order.category,
          subject: order.subject,
          brand: order.brand,
          techSize: order.techSize,
          totalPrice: order.totalPrice,
          discountPercent: order.discountPercent,
          priceWithDisc: order.priceWithDisc,
          isCancel: order.isCancel,
          cancelDate: order.cancelDate
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
}

module.exports = WB;
