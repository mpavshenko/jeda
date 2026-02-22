const axios = require('axios');
const { ozonConfig } = require('../config');

// const sleep = () => new Promise(r => setTimeout(r, ozonConfig.requestDelay));

class Ozon {
  constructor() {
    this.apiCallCount = 0;

    this.client = axios.create({
      baseURL: ozonConfig.baseURL,
      headers: {
        'Client-Id': ozonConfig.clientId,
        'Api-Key': ozonConfig.apiKey,
        'Content-Type': 'application/json'
      }
    });

    // rate limiting and API call counting
    this.client.interceptors.request.use(async (axiosConfig) => {
      this.apiCallCount++;

      if (this.lastRequestTime) {
        const timeDiff = Date.now() - this.lastRequestTime;
        if (timeDiff < ozonConfig.requestDelay) {
          await new Promise(resolve => setTimeout(resolve, ozonConfig.requestDelay - timeDiff));
        }
      }
      this.lastRequestTime = Date.now();
      return axiosConfig;
    });

    // error handling with retry on 429
    this.client.interceptors.response.use(
      response => response,
      async error => {
        const config = error.config;
        if (error.response?.status === 429 && (config._retryCount || 0) < ozonConfig.maxRetries) {
          config._retryCount = (config._retryCount || 0) + 1;
          const delay = ozonConfig.requestDelay * Math.pow(2, config._retryCount);
          console.warn(`Rate limited (429). Retry ${config._retryCount}/${ozonConfig.maxRetries} after ${delay}ms... [${config.url}]`);
          await new Promise(resolve => setTimeout(resolve, delay));
          this.lastRequestTime = Date.now();
          return this.client(config);
        }

        if (error.response) {
          console.error('OZON API Error:', {
            status: error.response.status,
            statusText: error.response.statusText,
            data: error.response.data,
            url: config?.url
          });
        } else {
          console.error('OZON API Error:', error.message);
        }
        return Promise.reject(error);
      }
    );
  }

  /*
  Result example:
  [
    {
      "product_id": 690217218,
      "offer_id": "42E581",
      "has_fbo_stocks": false,
      "has_fbs_stocks": false,
      "archived": false,
      "is_discounted": false,
      "quants": []
    },
    {
      "product_id": 692706089,
      "offer_id": "97-536",
      "has_fbo_stocks": false,
      "has_fbs_stocks": false,
      "archived": false,
      "is_discounted": false,
      "quants": []
    },...
  ]
  */
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

  /*
  Result example:
  [
    {
      "product_id": 690217218,
      "offer_id": "42E581",
      "name": "Пистолет клеевой электрический, 8 мм, 10 Вт Top Tools 42E581",
      "sku": 1257270294
    },
    {
      "product_id": 692706089,
      "offer_id": "97-536",
      "name": "Наколенники защитные NEO Tools 97-536",
      "sku": 1259481632
    },...]
  */
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

  /*
  Result example:
  {
  "items": [
    {
      "acquiring": 3.36,
      "offer_id": "42E581",
      "product_id": 690217218,
      "volume_weight": 0.2,
      "commissions": {
        "fbo_deliv_to_customer_amount": 25,
        "fbo_direct_flow_trans_max_amount": 115.93,
        "fbo_direct_flow_trans_min_amount": 56.94,
        "fbo_return_flow_amount": 56.94,
        "fbs_deliv_to_customer_amount": 25,
        "fbs_direct_flow_trans_min_amount": 99.64,
        "fbs_direct_flow_trans_max_amount": 99.64,
        "fbs_first_mile_max_amount": 20,
        "fbs_first_mile_min_amount": 10,
        "fbs_return_flow_amount": 99.64,
        "sales_percent_fbo": 38,
        "sales_percent_fbs": 40,
        "sales_percent_rfbs": 38,
        "sales_percent_fbp": 38
      },
      "marketing_actions": {
        "current_period_from": null,
        "current_period_to": null,
        "actions": [
          {
            "title": "Новогодний максимальный бустинг: усиление",
            "value": 336,
            "date_from": "2025-12-07T21:00:00Z",
            "date_to": "2026-02-25T20:59:59Z"
          }
        ],
        "ozon_actions_exist": false
      },
      "price": {
        "auto_action_enabled": true,
        "currency_code": "RUB",
        "marketing_seller_price": 336,
        "min_price": 212,
        "old_price": 935,
        "price": 420,
        "retail_price": 0,
        "vat": 0.22,
        "auto_add_to_ozon_actions_list_enabled": false,
        "net_price": 0
      },
      "price_indexes": {
        "external_index_data": {
          "min_price": 0,
          "min_price_currency": "RUB",
          "price_index_value": 0
        },
        "ozon_index_data": {
          "min_price": 0,
          "min_price_currency": "RUB",
          "price_index_value": 0
        },
        "color_index": "WITHOUT_INDEX",
        "self_marketplaces_index_data": {
          "min_price": 0,
          "min_price_currency": "RUB",
          "price_index_value": 0
        }
      }
    },...]
  */

  async getProductPrices(productIds, lastId = '') {
    try {
      const body = {
        filter: {
          product_id: productIds,
        },
        last_id: lastId,
        limit: 1000
      };

      const response = await this.client.post('/v5/product/info/prices', body);
      return response.data;
    } catch (error) {
      console.error('Error fetching product info prices:', error.response?.data || error.message);
      throw error;
    }
  }

  /*
  Result example:
  
{
  "result": [
    {
      "id": 690217218,
      "barcode": "5902062130679",
      "name": "Пистолет клеевой электрический, 8 мм, 10 Вт Top Tools 42E581",
      "offer_id": "42E581",
      "height": 58,
      "depth": 192,
      "width": 110,
      "dimension_unit": "mm",
      "weight": 138,
      "weight_unit": "g",
      "description_category_id": 200001425,
      "type_id": 95575,
      "primary_image": "https://cdn1.ozone.ru/s3/multimedia-u/6813424146.jpg",
      "model_info": {
        "model_id": 285814011,
        "count": 1
      },
      "images": [
        "https://cdn1.ozone.ru/s3/multimedia-1-j/6953754115.jpg",
        "https://cdn1.ozone.ru/s3/multimedia-v/6813424147.jpg",
        "https://cdn1.ozone.ru/s3/multimedia-1-k/6973116752.jpg"
      ],
      "pdf_list": [],
      "attributes": [
        {
          "id": 10096,
          "complex_id": 0,
          "values": [
            {
              "dictionary_value_id": 61574,
              "value": "черный"
            }
          ]
        }, ...
      ],
      "complex_attributes": [],
      "color_image": "",
      "sku": 1257270294,
      "barcodes": [
        "5902062130679"
      ],
      "attributes_with_defaults": [
        10100,
        11794,
        ...
      ]
    }, ...
    ]
  }
  */
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

  /* Result example:
  [{
    "status": "delivered",
    "products": [
      {
        "price": "7341.0000",
        "offer_id": "D82050-41",
        "name": "Полуботинки рабочие со стальным подноском",
        "sku": 2136393903,
        "quantity": 1,
        "currency_code": "RUB",
        "is_blr_traceable": false,
        "is_marketplace_buyout": false,
        "imei": []
      }
    ],
    "cluster_from": "Москва, МО и Дальние регионы",
    "cluster_to": "Москва, МО и Дальние регионы"
  }]*/
  async getAllFbsOrders(dateFrom, dateTo) {
    const allOrders = [];
    let offset = 0;
    const limit = 1000;
    let hasMore = true;

    while (hasMore) {
      console.log(`Fetching FBS orders batch with offset: ${offset}`);

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
        const response = await this.client.post('/v3/posting/fbs/list', body);
        const result = response.data.result || {};
        const orders = result.postings || [];

        if (orders.length > 0) {
          // Transform to only include used fields
          const transformedOrders = orders.map(order => ({
            status: order.status,
            products: order.products,
            cluster_from: order.financial_data?.cluster_from || null,
            cluster_to: order.financial_data?.cluster_to || null
          }));

          allOrders.push(...transformedOrders);
          console.log(`Fetched ${orders.length} FBS orders. Total so far: ${allOrders.length}`);

          if (orders.length < limit || !result.has_next) {
            hasMore = false;
          } else {
            offset += limit;
          }
        } else {
          hasMore = false;
        }
      } catch (error) {
        console.error(`Error fetching FBS orders at offset ${offset}:`, error.response?.data || error.message);
        throw error;
      }
    }

    console.log(`Successfully fetched all ${allOrders.length} FBS orders`);
    return allOrders;
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
          // Transform to only include used fields
          const transformedOrders = orders.map(order => ({
            status: order.status,
            products: order.products,
            cluster_from: order.financial_data?.cluster_from || null,
            cluster_to: order.financial_data?.cluster_to || null
          }));

          allOrders.push(...transformedOrders);
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
    "warehouses": [
      { "id": 1020000890160000, "name": "ЯРОСЛАВЛЬ_АППЗ_1" },
      { "id": 1020001007805000, "name": "КОСТРОМА_АППЗ_2" }
    ]
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
                clusterData.warehouses.push({
                  id: warehouse.warehouse_id,
                  name: warehouse.name
                });
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
    "1020000890160000": "Ярославль",
    "1020001007805000": "Ярославль",
    "ЯРОСЛАВЛЬ_АППЗ_1": "Ярославль",
    "КОСТРОМА_АППЗ_2": "Ярославль",
    "ПЕРМЬ_РФЦ": "Урал",
    "Пермь_КГТ": "Урал"
  }*/
  createWarehouseToClusterMap(clustersArray) {
    return clustersArray.reduce((map, cluster) => {
      cluster.warehouses.forEach(warehouse => {
        // Map both ID and name to cluster
        map[warehouse.id] = cluster.cluster_name;
        map[warehouse.name] = cluster.cluster_name;
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
      "fboTotal": 3,
      "fbsTotal": 1,
      "total": 4,
      "daily": 0.12903225806451613,
      "stock": 4,
      "in_transit": 2
    },
    "Саратов": {
      "fboTotal": 0,
      "fbsTotal": 1,
      "total": 1,
      "daily": 0.03225806451612903,
      "stock": 2,
      "in_transit": 0
    }
  }*/
  mergeOrdersWithStocks(orderedProductsByCluster, stocksByCluster, inTransitByCluster = {}) {
    const result = [];
    const processedOfferIds = new Set();

    // Process products with orders
    orderedProductsByCluster.forEach(product => {
      const stockData = stocksByCluster[product.offer_id];
      const inTransitData = inTransitByCluster[product.offer_id];
      const enrichedProduct = {
        ...product,
        clusters: {}
      };

      // Merge order data with stock data and in-transit data for each cluster
      Object.keys(product.clusters).forEach(clusterName => {
        enrichedProduct.clusters[clusterName] = {
          fboTotal: product.clusters[clusterName].fboTotal,
          fbsTotal: product.clusters[clusterName].fbsTotal,
          total: product.clusters[clusterName].total,
          daily: product.clusters[clusterName].daily,
          stock: stockData?.clusters?.[clusterName]?.free_to_sell_amount || 0,
          in_transit: inTransitData?.[clusterName] || 0
        };
      });

      // Add clusters that only exist in stock data (with 0 orders)
      if (stockData) {
        Object.keys(stockData.clusters).forEach(clusterName => {
          if (!enrichedProduct.clusters[clusterName]) {
            enrichedProduct.clusters[clusterName] = {
              fboTotal: 0,
              fbsTotal: 0,
              total: 0,
              daily: 0,
              stock: stockData.clusters[clusterName].free_to_sell_amount || 0,
              in_transit: inTransitData?.[clusterName] || 0
            };
          }
        });
      }

      // Add clusters that only exist in in-transit data (with 0 orders and 0 stock)
      if (inTransitData) {
        Object.keys(inTransitData).forEach(clusterName => {
          if (!enrichedProduct.clusters[clusterName]) {
            enrichedProduct.clusters[clusterName] = {
              fboTotal: 0,
              fbsTotal: 0,
              total: 0,
              daily: 0,
              stock: 0,
              in_transit: inTransitData[clusterName] || 0
            };
          }
        });
      }

      result.push(enrichedProduct);
      processedOfferIds.add(product.offer_id);
    });

    // Add products that have ONLY in-transit (no orders)
    Object.keys(inTransitByCluster).forEach(offerId => {
      if (!processedOfferIds.has(offerId)) {
        const stockData = stocksByCluster[offerId];
        const inTransitData = inTransitByCluster[offerId];
        const product = {
          offer_id: offerId,
          name: null, // No name available for products without orders
          clusters: {}
        };

        // Add all in-transit clusters
        Object.keys(inTransitData).forEach(clusterName => {
          product.clusters[clusterName] = {
            fboTotal: 0,
            fbsTotal: 0,
            total: 0,
            daily: 0,
            stock: stockData?.clusters?.[clusterName]?.free_to_sell_amount || 0,
            in_transit: inTransitData[clusterName] || 0
          };
        });

        // Add stock-only clusters (if product has stocks in clusters without in-transit)
        if (stockData) {
          Object.keys(stockData.clusters).forEach(clusterName => {
            if (!product.clusters[clusterName]) {
              product.clusters[clusterName] = {
                fboTotal: 0,
                fbsTotal: 0,
                total: 0,
                daily: 0,
                stock: stockData.clusters[clusterName].free_to_sell_amount || 0,
                in_transit: 0
              };
            }
          });
        }

        result.push(product);
        processedOfferIds.add(offerId);
      }
    });

    return result;
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
    "name": "Полукомбинезон рабочий спецодежда DOWELL HD большие размеры",
    "quantity": 1,
    "offer_id": "D81240-4XL",
    "cluster_to": "Дальний Восток"
  }*/
  getFlattenedOrderedProducts(orders) {
    return orders.flatMap(order =>
      order.products.map(product => ({
        name: product.name,
        quantity: product.quantity,
        offer_id: product.offer_id,
        cluster_to: order.cluster_to
      }))
    );
  }


  /* Result example:
  {
    "offer_id": "D81240-4XL",
    "name": "Полукомбинезон рабочий спецодежда DOWELL HD большие размеры",
    "clusters": {
      "Дальний Восток": { fboTotal: 2, fbsTotal: 1, total: 3, daily: 0.1 },
      "Юг": { fboTotal: 0, fbsTotal: 1, total: 1, daily: 0.033 },
      "Москва, МО и Дальние регионы": { fboTotal: 1, fbsTotal: 1, total: 2, daily: 0.067 },
      "Санкт-Петербург и СЗО": { fboTotal: 3, fbsTotal: 1, total: 4, daily: 0.133 },
      "Сибирь": { fboTotal: 1, fbsTotal: 0, total: 1, daily: 0.033 },
      "Казань": { fboTotal: 0, fbsTotal: 1, total: 1, daily: 0.033 }
    }
  }*/
  calculateProductQuantityByCluster(fboProducts, fbsProducts, daysCovered) {
    const result = {};

    // Process FBO orders
    fboProducts.forEach(product => {
      const { offer_id, name, quantity, cluster_to } = product;
      const cluster = cluster_to || 'Unknown';

      if (!result[offer_id]) {
        result[offer_id] = { offer_id, name, clusters: {} };
      }

      if (!result[offer_id].clusters[cluster]) {
        result[offer_id].clusters[cluster] = { fboTotal: 0, fbsTotal: 0, total: 0, daily: 0 };
      }

      result[offer_id].clusters[cluster].fboTotal += quantity;
    });

    // Process FBS orders
    fbsProducts.forEach(product => {
      const { offer_id, name, quantity, cluster_to } = product;
      const cluster = cluster_to || 'Unknown';

      if (!result[offer_id]) {
        result[offer_id] = { offer_id, name, clusters: {} };
      }

      if (!result[offer_id].clusters[cluster]) {
        result[offer_id].clusters[cluster] = { fboTotal: 0, fbsTotal: 0, total: 0, daily: 0 };
      }

      result[offer_id].clusters[cluster].fbsTotal += quantity;
    });

    // Calculate totals and daily averages
    Object.values(result).forEach(product => {
      Object.values(product.clusters).forEach(cluster => {
        cluster.total = cluster.fboTotal + cluster.fbsTotal;
        cluster.daily = cluster.total / daysCovered;
      });
    });

    return Object.values(result);
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

  // Get all supply order IDs with specified states
  async getSupplyOrderIds() {
    const states = [
      "DATA_FILLING",
      "READY_TO_SUPPLY",
      "ACCEPTED_AT_SUPPLY_WAREHOUSE",
      "IN_TRANSIT",
      "ACCEPTANCE_AT_STORAGE_WAREHOUSE"
    ];

    let allSupplyOrderIds = [];
    let fromSupplyOrderId = null;

    while (true) {
      const body = {
        filter: {
          states: states
        },
        last_id: null,
        limit: 100,
        sort_by: "ORDER_CREATION",
        sort_dir: "DESC"
      };

      if (fromSupplyOrderId) {
        body.last_id = fromSupplyOrderId;
      }

      try {
        const response = await this.client.post('/v3/supply-order/list', body);
        const supplyOrderIds = response.data.order_ids || [];

        if (supplyOrderIds.length === 0) {
          break;
        }

        allSupplyOrderIds.push(...supplyOrderIds);
        fromSupplyOrderId = response.data.last_id;

        if (!fromSupplyOrderId) {
          break;
        }
      } catch (error) {
        console.error('Error fetching supply order IDs:', error.message);
        throw error;
      }
    }

    return allSupplyOrderIds;
  }

  /* Result example (API v4+):
  [{
    "order_id": 123456,
    "order_number": "0070605-0001-1",
    "created_date": "2024-01-15T10:00:00Z",
    "state": "IN_TRANSIT",
    "supplies": [
      {
        "supply_id": 789012,
        "storage_warehouse": {
          "warehouse_id": 22852653853000,
          "arrival_date": "2024-01-20",
          "address": "Moscow warehouse",
          "name": "MOSCOW_RFC"
        },
        "bundle_id": "238525925853000",
        "state": "IN_TRANSIT",
        "is_crossdock": false
      }
    ]
  }]
  Fields used in code:
  - order.order_number (was: supply_order_number)
  - order.supplies (array)
  - supply.storage_warehouse.warehouse_id (was: storage_warehouse_id)
  - supply.bundle_id (now string, was number)
  */
  async getSupplyOrdersInfo(supplyOrderIds) {
    const BATCH_SIZE = 50;
    let allOrders = [];

    for (let i = 0; i < supplyOrderIds.length; i += BATCH_SIZE) {
      const batchIds = supplyOrderIds.slice(i, i + BATCH_SIZE);

      try {
        const response = await this.client.post('/v3/supply-order/get', {
          order_ids: batchIds
        });

        const orders = response.data.orders || [];
        allOrders.push(...orders);
      } catch (error) {
        console.error(`Error fetching supply orders batch ${i}-${i + BATCH_SIZE}:`, error.message);
        throw error;
      }
    }

    return allOrders;
  }

  // Get bundle items with pagination
  async getBundleItems(bundleId) {
    let allItems = [];
    let lastId = null;

    while (true) {
      const body = {
        bundle_ids: [bundleId],
        limit: 50
      };

      if (lastId) {
        body.last_id = lastId;
      }

      try {
        const response = await this.client.post('/v1/supply-order/bundle', body);
        const items = response.data.items || [];

        if (items.length === 0) {
          break;
        }

        allItems.push(...items);

        const hasNext = response.data.has_next;
        lastId = response.data.last_id;

        if (!hasNext || !lastId) {
          break;
        }
      } catch (error) {
        console.error(`Error fetching bundle items for bundle ${bundleId}:`, error.message);
        throw 'getBundleItemsError';
      }
    }

    return allItems;
  }

  // Get all supply orders with only necessary data
  async getAllSupplyOrders() {
    const supplyOrderIds = await this.getSupplyOrderIds();
    console.log(`Found ${supplyOrderIds.length} supply orders`);

    const orders = await this.getSupplyOrdersInfo(supplyOrderIds);
    console.log(`Fetched ${orders.length} supply order details`);

    // Extract only needed data: supplies with storage_warehouse_id and bundle_id
    return orders.map(order => ({
      supplies: (order.supplies || []).map(supply => ({
        storage_warehouse_id: supply.storage_warehouse?.warehouse_id || supply.storage_warehouse_id, // Support both old and new format
        bundle_id: supply.bundle_id,
        order: order.order_number || order.supply_order_number // Support both old and new format
      }))
    }));
  }

  // Get all bundle items for multiple bundles with only necessary fields
  async getAllBundleItems(orders) {
    const allBundleItems = [];

    for (const order of orders) {
      const supplies = order.supplies || [];

      for (const supply of supplies) {
        const storageWarehouseId = supply.storage_warehouse_id;
        const bundleId = supply.bundle_id;

        if (!storageWarehouseId || !bundleId) {
          continue;
        }

        console.log(`Fetching bundle ${bundleId} items...`);
        const items = await this.getBundleItems(bundleId);

        // Extract only needed fields: offer_id, quantity, storage_warehouse_id
        items.forEach(item => {
          allBundleItems.push({
            offer_id: item.offer_id,
            quantity: item.quantity,
            name: item.name,
            storage_warehouse_id: storageWarehouseId
          });
        });
      }
    }

    return allBundleItems;
  }

  /* Result example:
  {
    "D81240-4XL": {
      "Москва, МО и Дальние регионы": 10,
      "Санкт-Петербург и СЗО": 5
    },
    "D81140-L": {
      "Казань": 3
    }
  }*/
  calculateInTransitByCluster(bundleItems, warehouseToClusterMap) {
    const inTransitByCluster = {};

    bundleItems.forEach(item => {
      const offerId = item.offer_id || '';
      const quantity = item.quantity || 0;
      const storageWarehouseId = item.storage_warehouse_id;
      const clusterName = warehouseToClusterMap[storageWarehouseId];

      if (!clusterName || !offerId) {
        return;
      }

      if (!inTransitByCluster[offerId]) {
        inTransitByCluster[offerId] = {};
      }
      if (!inTransitByCluster[offerId][clusterName]) {
        inTransitByCluster[offerId][clusterName] = 0;
      }

      inTransitByCluster[offerId][clusterName] += quantity;
    });

    return inTransitByCluster;
  }

  getApiCallCount() {
    return this.apiCallCount;
  }

  resetApiCallCount() {
    this.apiCallCount = 0;
  }

}

module.exports = Ozon;
