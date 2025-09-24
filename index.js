const Ozon = require('./services/ozon');
const json = o => JSON.stringify(o, null, 2)

async function main() {
  console.log("Starting...");

  const ozon = new Ozon();

  try {
    const response = await ozon.getProducts(3);
    console.log(json(response));

    const all = await ozon.getAllProducts();
    console.log(all.length);
    console.log(json(all[0]));
    console.table(all);

    return;

    const ids = response.result.items.map(item => item.product_id);

    const detailedInfo = await ozon.getProductDetails(ids);

    console.log(`Total products: ${detailedInfo.result.total || detailedInfo.result.length}`);

    detailedInfo.result.slice(0, 1).forEach((product, index) => {
      console.log(`Product ${index + 1}:`);
      console.log(JSON.stringify(product, null, 2));
      console.log('---');
    });

    const infoMap = new Map(detailedInfo.result.map(p => [p.id, p]));

    console.log([...infoMap.keys()]);

    const products = response.result.items.map(p => ({
      product_id: p.product_id,
      offer_id: p.offer_id,
      // info_offer_id: infoMap.get(p.product_id).offer_id,
      info_name: infoMap.get(p.product_id).name,
      info_sku: infoMap.get(p.product_id).sku
    }));

    console.table(products);

    // 2021-09-01T00:00:00.000Z

    // const orders = await ozon.getFboOrders('2025-09-01T00:00:00.000Z', '2025-09-02T23:59:59.000Z');
    // console.log(JSON.stringify(orders, null, 2));
    // console.log(`Found ${orders.length} orders`);
    // if (orders.length > 0) {
    //   console.log(JSON.stringify(orders[0], null, 2));
    // }


  } catch (error) {
    console.error('Error fetching products:', error.message);
  }
}

main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});

