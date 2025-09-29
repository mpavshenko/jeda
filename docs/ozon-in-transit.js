const axios = require('axios');

class OzonInTransitCalculator {
    constructor(clientId, apiKey) {
        this.clientId = clientId;
        this.apiKey = apiKey;
        this.baseURL = 'https://api-seller.ozon.ru';

        this.client = axios.create({
            baseURL: this.baseURL,
            headers: {
                'Client-Id': this.clientId,
                'Api-Key': this.apiKey,
                'Content-Type': 'application/json'
            }
        });
    }

    // Get all supply order IDs with specified states
    async getSupplyOrderIds() {
        const states = [
            "ORDER_STATE_DATA_FILLING",
            "ORDER_STATE_READY_TO_SUPPLY",
            "ORDER_STATE_ACCEPTED_AT_SUPPLY_WAREHOUSE",
            "ORDER_STATE_IN_TRANSIT",
            "ORDER_STATE_ACCEPTANCE_AT_STORAGE_WAREHOUSE"
        ];

        let allSupplyOrderIds = [];
        let fromSupplyOrderId = null;

        while (true) {
            const body = {
                filter: {
                    states: states
                },
                paging: {
                    limit: 100
                }
            };

            if (fromSupplyOrderId) {
                body.paging.from_supply_order_id = fromSupplyOrderId;
            }

            try {
                const response = await this.client.post('/v2/supply-order/list', body);
                const supplyOrderIds = response.data.supply_order_id || [];

                if (supplyOrderIds.length === 0) {
                    break;
                }

                allSupplyOrderIds.push(...supplyOrderIds);
                fromSupplyOrderId = response.data.last_supply_order_id;

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

    // Get detailed info for supply orders in batches
    async getSupplyOrdersInfo(supplyOrderIds) {
        const BATCH_SIZE = 50;
        let allOrders = [];

        for (let i = 0; i < supplyOrderIds.length; i += BATCH_SIZE) {
            const batchIds = supplyOrderIds.slice(i, i + BATCH_SIZE);

            try {
                const response = await this.client.post('/v2/supply-order/get', {
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

    // Get warehouse to cluster mapping
    async getWarehouseToClusterMap() {
        try {
            const response = await this.client.post('/v1/cluster/list', {
                cluster_type: 'CLUSTER_TYPE_OZON'
            });

            const warehouseToCluster = {};
            const clusters = response.data.clusters || [];

            for (const cluster of clusters) {
                const clusterName = cluster.name;
                const logisticClusters = cluster.logistic_clusters || [];

                for (const logisticCluster of logisticClusters) {
                    const warehouses = logisticCluster.warehouses || [];

                    for (const warehouse of warehouses) {
                        warehouseToCluster[warehouse.warehouse_id] = clusterName;
                    }
                }
            }

            return warehouseToCluster;
        } catch (error) {
            console.error('Error fetching warehouse to cluster mapping:', error.message);
            throw error;
        }
    }

    // Get bundle items with pagination
    async getBundleItems(bundleId) {
        let allItems = [];
        let lastId = null;

        while (true) {
            const body = {
                bundle_id: bundleId,
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
                throw error;
            }
        }

        return allItems;
    }

    // Convert offer_id to product_code (placeholder - implement your logic)
    getProductCodeByOfferId(offerId) {
        // This should implement your business logic to convert offer_id to product_code
        // For now, returning offer_id as product_code
        return offerId;
    }

    // Main function to calculate in-transit amounts by cluster
    async calculateInTransitAmounts() {
        try {
            console.log('Fetching supply order IDs...');
            const supplyOrderIds = await this.getSupplyOrderIds();
            console.log(`Found ${supplyOrderIds.length} supply orders`);

            console.log('Fetching warehouse to cluster mapping...');
            const warehouseToClusterMap = await this.getWarehouseToClusterMap();
            console.log(`Found ${Object.keys(warehouseToClusterMap).length} warehouse mappings`);

            console.log('Fetching supply orders info...');
            const orders = await this.getSupplyOrdersInfo(supplyOrderIds);
            console.log(`Processing ${orders.length} orders`);

            // Initialize cluster product counts
            const clusterProductCounts = {};

            // Process each order
            for (const order of orders) {
                const supplies = order.supplies || [];

                for (const supply of supplies) {
                    const storageWarehouseId = supply.storage_warehouse_id;
                    const bundleId = supply.bundle_id;

                    if (!storageWarehouseId || !bundleId) {
                        continue;
                    }

                    const clusterName = warehouseToClusterMap[storageWarehouseId];
                    if (!clusterName) {
                        continue;
                    }

                    console.log(`Processing bundle ${bundleId} for cluster ${clusterName}...`);
                    const items = await this.getBundleItems(bundleId);

                    for (const item of items) {
                        const offerId = item.offer_id || '';
                        const quantity = item.quantity || 0;
                        const productCode = this.getProductCodeByOfferId(offerId);

                        // Initialize nested objects if they don't exist
                        if (!clusterProductCounts[productCode]) {
                            clusterProductCounts[productCode] = {};
                        }
                        if (!clusterProductCounts[productCode][clusterName]) {
                            clusterProductCounts[productCode][clusterName] = 0;
                        }

                        clusterProductCounts[productCode][clusterName] += quantity;
                    }
                }
            }

            return clusterProductCounts;

        } catch (error) {
            console.error('Error calculating in-transit amounts:', error.message);
            throw error;
        }
    }

    // Helper function to get in-transit amount for specific product and cluster
    getInTransitAmount(clusterProductCounts, productCode, clusterName) {
        return clusterProductCounts[productCode]?.[clusterName] || 0;
    }

    // Helper function to get total in-transit amount for a product across all clusters
    getTotalInTransitAmount(clusterProductCounts, productCode) {
        const productCounts = clusterProductCounts[productCode] || {};
        return Object.values(productCounts).reduce((sum, count) => sum + count, 0);
    }
}

// Example usage
async function main() {
    // Replace with your actual credentials
    const CLIENT_ID = 'your_client_id';
    const API_KEY = 'your_api_key';

    const calculator = new OzonInTransitCalculator(CLIENT_ID, API_KEY);

    try {
        const inTransitAmounts = await calculator.calculateInTransitAmounts();

        console.log('\n=== IN-TRANSIT AMOUNTS BY CLUSTER ===');

        // Display results
        for (const [productCode, clusters] of Object.entries(inTransitAmounts)) {
            console.log(`\nProduct: ${productCode}`);
            for (const [clusterName, amount] of Object.entries(clusters)) {
                console.log(`  ${clusterName}: ${amount} units`);
            }

            const totalAmount = calculator.getTotalInTransitAmount(inTransitAmounts, productCode);
            console.log(`  Total: ${totalAmount} units`);
        }

        // Example: Get specific in-transit amount
        const exampleProduct = Object.keys(inTransitAmounts)[0];
        const exampleCluster = 'Москва, МО и Дальние регионы';
        if (exampleProduct) {
            const specificAmount = calculator.getInTransitAmount(inTransitAmounts, exampleProduct, exampleCluster);
            console.log(`\nExample: ${exampleProduct} in ${exampleCluster}: ${specificAmount} units`);
        }

    } catch (error) {
        console.error('Failed to calculate in-transit amounts:', error.message);
        process.exit(1);
    }
}

// Run if this file is executed directly
if (require.main === module) {
    main();
}

module.exports = OzonInTransitCalculator;