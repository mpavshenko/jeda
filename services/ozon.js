const axios = require('axios');
const config = require('../config');

// const sleep = () => new Promise(r => setTimeout(r, config.requestDelay));

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

    // rate limiting
    this.client.interceptors.request.use(async (axiosConfig) => {
      if (this.lastRequestTime) {
        const timeDiff = Date.now() - this.lastRequestTime;
        if (timeDiff < config.requestDelay) {
          await new Promise(resolve => setTimeout(resolve, config.requestDelay - timeDiff));
        }
      }
      this.lastRequestTime = Date.now();
      return axiosConfig;
    });

    // error handling
    this.client.interceptors.response.use(
      response => response,
      error => {
        console.error('OZON API Error:', error.response?.data || error.message);
        return Promise.reject(error);
      }
    );
  }

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

  async #enrichProductsWithDetails(products) {
    const ids = products.map(item => item.product_id);

    console.log(`Getting products info...`);
    const detailedInfo = await this.getProductDetails(ids);
    console.log(`Got info for ${detailedInfo.result.length} products`);

    const infoMap = new Map(detailedInfo.result.map(p => [p.id, p]));
    return products.map(p => ({
      product_id: p.product_id,
      offer_id: p.offer_id,
      name: infoMap.get(p.product_id)?.name || null,
      sku: infoMap.get(p.product_id)?.sku || null
    }));
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
        console.log(`Fetched ${result.items.length} products of ${result.total}. Total so far: ${all.length}, lastID: ${lastId}`);
        total = result.total;

        const products = await this.#enrichProductsWithDetails(result.items)
        all.push(...products);

        if (result.items.length < limit || all.length >= result.total) {
          hasMore = false;
        } else {
          lastId = result.last_id;
        }
      } else {
        hasMore = false;
      }
    }

    if (all.length != total)
      console.warn(`Mismatch all products count: fetched=${all.length}, required=${total}`);

    return all;
  }

  async getProductDetails(productIds, offerId = null) {
    try {
      const body = {
        filter: {
          product_id: productIds,
        },
        limit: 1000
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
      return response.data.result;
    } catch (error) {
      console.error('Error fetching FBO orders:', error.response?.data || error.message);
      throw error;
    }
  }

  async getAllFboOrders(dateFrom, dateTo) {
    const allOrders = [];
    let offset = 0;
    const limit = 1000;
    let hasMore = true;

    while (hasMore) {
      console.log(`Fetching FBO orders batch with offset: ${offset}`);

      const body = {
        dir: "ASC",
        filter: {
          since: dateFrom,
          to: dateTo
        },
        limit,
        offset,
        with: {
          analytics_data: true,
          financial_data: true
        }
      };

      try {
        const response = await this.client.post('/v2/posting/fbo/list', body);
        const orders = response.data.result || [];

        if (orders.length > 0) {
          allOrders.push(...orders);
          console.log(`Fetched ${orders.length} orders. Total so far: ${allOrders.length}`);

          if (orders.length < limit) {
            hasMore = false;
          } else {
            offset += limit;
          }
        } else {
          hasMore = false;
        }
      } catch (error) {
        console.error(`Error fetching FBO orders at offset ${offset}:`, error.response?.data || error.message);
        throw error;
      }
    }

    console.log(`Successfully fetched all ${allOrders.length} FBO orders`);
    return allOrders;
  }

  /* Result example:
  [{
    "cluster_name": "Ярославль",
    "warehouses": ["ЯРОСЛАВЛЬ_АППЗ_1","КОСТРОМА_АППЗ_2"]
  )]
  */
  async getClustersAndWarehouses() {
    try {
      const response = await this.client.post('/v1/cluster/list', {
        cluster_type: 'CLUSTER_TYPE_OZON'
      });

      const clusters = response.data.clusters || [];
      const result = [];

      clusters.forEach(cluster => {
        const clusterData = {
          cluster_name: cluster.name,
          warehouses: []
        };

        if (cluster.logistic_clusters) {
          cluster.logistic_clusters.forEach(logisticCluster => {
            if (logisticCluster.warehouses) {
              logisticCluster.warehouses.forEach(warehouse => {
                clusterData.warehouses.push(warehouse.name);
              });
            }
          });
        }

        result.push(clusterData);
      });

      console.log(`Found ${result.length} clusters with warehouses`);
      return result;
    } catch (error) {
      console.error('Error fetching clusters and warehouses:', error.response?.data || error.message);
      throw error;
    }
  }

  /* Result example:
  {
    "ЯРОСЛАВЛЬ_АППЗ_1": "Ярославль",
    "КОСТРОМА_АППЗ_2": "Ярославль",
    "ПЕРМЬ_РФЦ": "Урал",
    "Пермь_КГТ": "Урал"
  }*/
  createWarehouseToClusterMap(clustersArray) {
    return clustersArray.reduce((map, cluster) => {
      cluster.warehouses.forEach(warehouseName => {
        map[warehouseName] = cluster.cluster_name;
      });
      return map;
    }, {});
  }

  /* Result example:
  [{
    "sku": 1259473384,
    "warehouse_name": "ЖУКОВСКИЙ_РФЦ",
    "item_code": "97-501",
    "item_name": "Очки защитные, желтые NEO Tools 97-501",
    "promised_amount": 0,
    "free_to_sell_amount": 4,
    "reserved_amount": 0
  }]*/
  async getAllStocks() {
    const allStocks = [];
    let offset = 0;
    const limit = 1000;
    let hasMore = true;

    while (hasMore) {
      console.log(`Fetching stocks batch with offset: ${offset}`);

      const body = {
        limit,
        offset
      };

      try {
        const response = await this.client.post('/v2/analytics/stock_on_warehouses', body);
        const result = response.data.result || {};
        const stocks = result.rows || [];

        if (stocks.length > 0) {
          allStocks.push(...stocks);
          console.log(`Fetched ${stocks.length} stock records. Total so far: ${allStocks.length}`);

          if (stocks.length < limit) {
            hasMore = false;
          } else {
            offset += limit;
          }
        } else {
          hasMore = false;
        }
      } catch (error) {
        console.error(`Error fetching stocks at offset ${offset}:`, error.response?.data || error.message);
        throw error;
      }
    }

    console.log(`Successfully fetched all ${allStocks.length} stock records`);
    return allStocks;
  }

  /* Result example:
  {
    "J72359": {
      "item_code": "J72359",
      "clusters": {
        "Дальний Восток": {
          "free_to_sell_amount": 0,
          "reserved_amount": 0,
          "promised_amount": 1
        },
        "Кавказ": {
          "free_to_sell_amount": 1,
          "reserved_amount": 0,
          "promised_amount": 1
        }
      }
    }
  }*/
  calculateStocksByCluster(stocks, warehouseToClusterMap) {
    return stocks.reduce((acc, stock) => {
      const cluster = warehouseToClusterMap[stock.warehouse_name] || 'Unknown';
      const itemCode = stock.item_code;

      if (!acc[itemCode]) {
        acc[itemCode] = {
          item_code: itemCode,
          clusters: {}
        };
      }

      if (!acc[itemCode].clusters[cluster]) {
        acc[itemCode].clusters[cluster] = {
          free_to_sell_amount: 0,
          reserved_amount: 0,
          promised_amount: 0
        };
      }

      acc[itemCode].clusters[cluster].free_to_sell_amount += stock.free_to_sell_amount || 0;
      acc[itemCode].clusters[cluster].reserved_amount += stock.reserved_amount || 0;
      acc[itemCode].clusters[cluster].promised_amount += stock.promised_amount || 0;

      return acc;
    }, {});
  }

  createOfferIdToNameMap(products) {
    return products.reduce((map, p) => {
      map[p.offer_id] = p.name;
      return map;
    }, {});
  }

  calculateDaysCovered(fromDate, toDate) {
    const from = new Date(fromDate);
    const to = new Date(toDate);
    const diffTime = Math.abs(to - from);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  }

  /* Result example: {
  "offer_id": "D81140-L",
  "name": "Полукомбинезон рабочий DOWELL White HD",
  "clusters": {
    "Казань": {
      "total": 4,
      "daily": 0.12903225806451613,
      "stock": 4
    },
    "Саратов": {
      "total": 1,
      "daily": 0.03225806451612903,
      "stock": 2
    }
  }*/
  mergeOrdersWithStocks(orderedProductsByCluster, stocksByCluster) {
    return orderedProductsByCluster.map(product => {
      const stockData = stocksByCluster[product.offer_id];
      const enrichedProduct = {
        ...product,
        clusters: {}
      };

      // Merge order data with stock data for each cluster
      Object.keys(product.clusters).forEach(clusterName => {
        enrichedProduct.clusters[clusterName] = {
          total: product.clusters[clusterName].total,
          daily: product.clusters[clusterName].daily,
          stock: stockData?.clusters?.[clusterName]?.free_to_sell_amount || 0
        };
      });

      // Add clusters that only exist in stock data (with 0 orders)
      if (stockData) {
        Object.keys(stockData.clusters).forEach(clusterName => {
          if (!enrichedProduct.clusters[clusterName]) {
            enrichedProduct.clusters[clusterName] = {
              total: 0,
              daily: 0,
              stock: stockData.clusters[clusterName].free_to_sell_amount || 0
            };
          }
        });
      }

      return enrichedProduct;
    });
  }

  transformStocksByClusterToFlat(stocksByCluster, offerIdToNameMap) {
    return Object.values(stocksByCluster).map(product => {
      const flatProduct = {
        offer_id: product.item_code,
        name: offerIdToNameMap[product.item_code] || 'Unknown Product'
      };

      // Add each cluster as a property with free_to_sell_amount value
      Object.keys(product.clusters).forEach(clusterName => {
        flatProduct[clusterName] = product.clusters[clusterName].free_to_sell_amount;
      });

      return flatProduct;
    });
  }

  /* Result example:
  {
    "created_at": "2025-06-01T01:52:02.042872Z",
    "sku": 1767829655,
    "name": "Полукомбинезон рабочий спецодежда DOWELL HD большие размеры",
    "quantity": 1,
    "offer_id": "D81240-4XL",
    "price": "3722.00",
    "cluster_from": "Уфа",
    "cluster_to": "Дальний Восток"
  }*/
  getFlattenedOrderedProducts(orders) {
    return orders.flatMap(order =>
      order.products.map(product => ({
        // created_at: order.created_at,
        // sku: product.sku,
        name: product.name,
        quantity: product.quantity,
        offer_id: product.offer_id,
        // price: product.price,
        // cluster_from: order.financial_data?.cluster_from || null,
        cluster_to: order.financial_data?.cluster_to || null
      }))
    );
  }


  /* Result example:
  {
    "offer_id": "D81240-4XL",
    "name": "Полукомбинезон рабочий спецодежда DOWELL HD большие размеры",
    "clusters": {
      "Дальний Восток": { total: 3, daily: 0.1 },
      "Юг": { total: 1, daily: 0.033 },
      "Москва, МО и Дальние регионы": { total: 2, daily: 0.067 },
      "Санкт-Петербург и СЗО": { total: 4, daily: 0.133 },
      "Сибирь": { total: 1, daily: 0.033 },
      "Казань": { total: 1, daily: 0.033 }
    }
  }*/
  calculateProductQuantityByCluster(orderedProducts, daysCovered) {
    return Object.values(
      orderedProducts.reduce((acc, product) => {
        const { offer_id, name, quantity, cluster_to } = product;
        const cluster = cluster_to || 'Unknown';

        if (!acc[offer_id]) {
          acc[offer_id] = { offer_id, name, clusters: {} };
        }

        if (!acc[offer_id].clusters[cluster]) {
          acc[offer_id].clusters[cluster] = { total: 0, daily: 0 };
        }

        acc[offer_id].clusters[cluster].total += quantity;
        acc[offer_id].clusters[cluster].daily = acc[offer_id].clusters[cluster].total / daysCovered;

        return acc;
      }, {})
    );
  }

  /* Result example:
  {
    "offer_id": "D81140-L",
    "name": "Полукомбинезон рабочий DOWELL White HD",
    "Казань": 4,
    "Саратов": 1,
    "Москва, МО и Дальние регионы": 8,
    "Урал": 1,
    "Юг": 3,
    "Воронеж": 2,
    "Сибирь": 3,
    "Ярославль": 2,
    "Санкт-Петербург и СЗО": 1
  }*/
  calculateProductQuantityByClusterFlat(orderedProducts) {
    return Object.values(
      orderedProducts.reduce((acc, product) => {
        const { offer_id, name, quantity, cluster_to } = product;
        const cluster = cluster_to || 'Unknown';

        if (!acc[offer_id]) {
          acc[offer_id] = { offer_id, name };
        }

        acc[offer_id][cluster] = (acc[offer_id][cluster] || 0) + quantity;

        return acc;
      }, {})
    );
  }

}

module.exports = Ozon;
