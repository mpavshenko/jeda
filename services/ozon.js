const axios = require('axios');
const config = require('../config');

const sleep = () => new Promise(r => setTimeout(r, config.requestDelay));

class Ozon {
  constructor() {
    this.client = axios.create({
      baseURL: config.baseURL,
      headers: {
        'Client-Id': config.clientId,
        'Api-Key': config.apiKey,
        'Content-Type': 'application/json'
      }
    });

    // for rate limiting
    // this.client.interceptors.request.use(async (config) => {
    //   if (this.lastRequestTime) {
    //     const timeDiff = Date.now() - this.lastRequestTime;
    //     if (timeDiff < config.requestDelay) {
    //       await new Promise(resolve => setTimeout(resolve, config.requestDelay - timeDiff));
    //     }
    //   }
    //   this.lastRequestTime = Date.now();
    //   return config;
    // });

    // for error handling
    this.client.interceptors.response.use(
      response => response,
      error => {
        console.error('OZON API Error:', error.response?.data || error.message);
        return Promise.reject(error);
      }
    );
  }

  // /v5/product/info/prices
  async getProducts(limit = 100, lastId = '') {
    try {
      const response = await this.client.post('/v3/product/list', {
        filter: {
          visibility: 'ALL'
        },
        limit,
        last_id: lastId
      });

      return response.data;
    } catch (error) {
      throw new Error(`Failed to get products: ${error.message}`);
    }
  }

  async getAllProducts() {
    const all = [];
    let lastId = '';
    let hasMore = true;
    let total = 0;
    const limit = 100;

    while (hasMore) {
      console.log(`Fetching products batch with lastId: ${lastId}`);

      const { result } = await this.getProducts(limit, lastId);

      if (result && result.items && result.items.length > 0) {
        total = result.total;

        console.log(`Getting products info`);
        const ids = result.items.map(item => item.product_id);
        // console.log(ids);
        const detailedInfo = await this.getProductDetails(ids);
        console.log(`Got info for ${detailedInfo.result.length} products`);
        const infoMap = new Map(detailedInfo.result.map(p => [p.id, p]));
        const products = result.items.map(p => ({
          product_id: p.product_id,
          offer_id: p.offer_id,
          name: infoMap.get(p.product_id).name,
          sku: infoMap.get(p.product_id).sku
        }));


        all.push(...products);
        console.log(`Fetched ${result.items.length} products of ${result.total}. Total so far: ${all.length}, lastID: ${lastId}`);

        if (result.items.length < limit || all.length >= result.total) {
          hasMore = false;
        } else {
          lastId = result.last_id;
        }
      } else {
        hasMore = false;
      }

      if (hasMore) sleep();
    }

    if (all.length != total)
      console.warn(`Mismatch all products count: fetched=${all.length}, required=${total}`);

    return all;
  }

  // /v3/product/info
  async getProductDetails(productIds, offerId = null) {
    try {
      const body = {
        filter: {
          product_id: productIds,
        },
        limit: 1
      };

      if (offerId) {
        body.offer_id = [offerId];
      }

      const response = await this.client.post('/v4/product/info/attributes', body);
      return response.data;
    } catch (error) {
      console.error('Error fetching product details:', error.response?.data || error.message);
      throw error;
    }
  }

  async getFboOrders(dateFrom, dateTo) {
    const body = {
      dir: "ASC",
      filter: {
        since: dateFrom,
        to: dateTo
      },
      limit: 1000,
      offset: 0,
      with: {
        analytics_data: true,
        financial_data: true
      }
    };

    try {
      const response = await this.client.post('/v2/posting/fbo/list', body);
      return response.data;
    } catch (error) {
      console.error('Error fetching FBO orders:', error.response?.data || error.message);
      throw error;
    }
  }
}

module.exports = Ozon;
