# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Node.js application for marketplace seller operations. The project provides fulfillment analytics and reporting for both Ozon and Wildberries marketplaces.

## Architecture

### Core Files
- **index.js**: Main entry point that loads server.js
- **server.js**: Server application (PM2 managed)
- **ffl.js**: Ozon fulfillment calculation and reporting
- **ffl-wb.js**: Wildberries fulfillment calculation (in progress)
- **config.js**: Configuration for both marketplaces:
  - Ozon API endpoints and authentication
  - Ozon rate limiting settings (500ms delay, 3 max retries)
  - Business logic constants (FBO stock supply days, safety stock days)
  - Regional delivery day mappings for Ozon clusters
  - Wildberries cluster-to-warehouse mappings

### Services
- **services/ozon.js**: Ozon API client and data processing
- **services/wb.js**: Wildberries API client and data processing
- **services/excel.js**: Excel report generation
- **services/1c.js**: 1C integration for stock data

### Tests
Integration tests are organized by marketplace:

**Shared tests** (`tests/`):
- **test-1c-stock.js**: 1C stock API integration test
  - Tests connection to 1C service
  - Validates data structure
  - Shows stock statistics and sample data
  - Run with: `node tests/test-1c-stock.js`

**Ozon tests** (`tests/ozon/`):
- **test-supply-order-ids.js**: Ozon supply order IDs integration test
  - Tests getSupplyOrderIds method
  - Validates response structure and ID formats
  - Shows statistics and sample data
  - Run with: `node tests/ozon/test-supply-order-ids.js`
- **test-supply-orders-info.js**: Ozon supply orders detailed info test
  - Tests getSupplyOrdersInfo method with first 5 IDs
  - Validates order structure and required fields
  - Shows order states and sample data
  - Run with: `node tests/ozon/test-supply-orders-info.js`

**Wildberries tests** (`tests/wb/`):
- **test-wb-supplies.js**: WB supplies API integration test
  - Tests WB supplies API (in-transit data)
  - Validates supply data aggregation
  - Shows warehouse mappings
  - Run with: `node tests/wb/test-wb-supplies.js`

### Environment Variables
- **Ozon**: `OZON_CLIENT_ID`, `OZON_API_KEY`, `OZON_BASE_URL`
- **Wildberries**: `WB_API_TOKEN`
- **1C**: 1C credentials for stock integration

## Development Commands

### Running the Application
```bash
npm start          # Run with node index.js
npm run dev        # Run with --watch flag for development
```

### Dependencies
- **axios**: HTTP client for API requests
- **dotenv**: Environment variable management
- **inquirer**: Interactive CLI prompts
- **nodemon**: Development dependency for auto-reloading

## API Documentation

- **Ozon API**: https://docs.ozon.ru/api/seller/
- **Wildberries API**: https://openapi.wildberries.ru/

## Business Logic

### Fulfillment Calculation Flow

Both Ozon and Wildberries follow a similar fulfillment data structure:

```javascript
{
  article: "D81140-L",           // Product SKU/article
  name: "Product name",
  price_1c: 1234.56,             // Price from 1C (optional)
  amount_1c: 100,                // Available stock in 1C (optional)
  clusters: {
    "Cluster Name": {
      fbo_total: 3,               // Orders from marketplace warehouse
      fbs_total: 1,               // Orders from seller warehouse
      total: 4,                   // Total orders
      daily: 0.129,               // Daily average (total/daysCovered)
      stock: 4,                   // Current stock at cluster
      in_transit: 2,              // Units in transit to cluster
      supply_need: 5              // Calculated supply requirement
    }
  }
}
```

### Warehouse Type Mappings

**Ozon:**
- FBO (Fulfillment by Ozon) = Orders from Ozon warehouse
- FBS (Fulfillment by Seller) = Orders from seller warehouse

**Wildberries:**
- "Склад WB" = Orders from WB warehouse (equivalent to FBO)
- "Склад продавца" = Orders from seller warehouse (equivalent to FBS)

### Calculation Constants

- Default analysis period: 28 days
- Stock coverage period: 28 days
- Fulfillment lead time: 14 days
- Supply need formula: `(daily × stockCoverageDays - in_transit) - (stock - fulfillmentLeadTimeDays × daily)`

## Data Processing Pipeline

### Ozon (ffl.js)
1. Fetch FBO and FBS orders for date range
2. Fetch warehouse/cluster mappings
3. Fetch current stock levels by warehouse
4. Fetch in-transit supply orders
5. Aggregate all data by product and cluster
6. Enrich with 1C stock data
7. Calculate supply needs
8. Generate Excel reports

### Wildberries (ffl-wb.js)
1. Fetch all product cards from catalog
2. Extract products with article codes (vendorCode-techSize)
3. Initialize fulfillment collection with products
4. Fetch orders from statistics API
5. Enrich orders with cluster mappings
6. Aggregate orders by product and cluster
7. Fetch stock data from stocks API
8. Fetch in-transit supplies from supplies API
9. Calculate supply needs based on orders, stock, and in-transit
10. Enrich with 1C stock data
11. Generate Excel reports (main report + cluster-specific reports)

## Key Implementation Details

### Article Code Construction

**Ozon:**
- Uses `offer_id` directly from product data
- Example: "D81140-L"

**Wildberries:**
- Single-size products: Uses `vendorCode` only
- Multi-size products: Combines `vendorCode-techSize`
- Example: "D81250-XL"

### Cluster/Warehouse Organization

**Ozon:**
- Hierarchical: Clusters contain multiple warehouses
- Mapping done via API: `/v1/cluster/list`
- Warehouses identified by both ID and name

**Wildberries:**
- Static mapping in config.js
- 8 main clusters: Центральный, Приволжский, Северо-Западный, Южный + Северо-Кавказский, Уральский, Беларусь, Грузия, Армения, Узбекистан
- Each cluster contains multiple warehouse names

### Rate Limiting

**Ozon:**
- Delay: 500ms between requests
- Max retries: 3
- Applied via axios interceptor

**Wildberries:**
- Statistics API: 60 seconds between requests (strict)
- Other endpoints: No enforced delay

## Code Formatting

The project is configured for consistent 2-space indentation:
- **VS Code settings**: `.vscode/settings.json` configures editor for 2 spaces, format on save using built-in formatters
- **EditorConfig**: `.editorconfig` for cross-editor consistency

## Communication Preferences

- **English corrections**: Always provide grammar and writing corrections for all user messages
- Show corrections at the end of responses in a dedicated "Language Corrections" section
- Include: spelling errors, missing articles (a/an/the), punctuation, capitalization, and better phrasing suggestions
- Keep corrections friendly and constructive to help improve English writing skills


# Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
