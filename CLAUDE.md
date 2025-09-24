# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Node.js application for Ozon marketplace seller operations. The project is structured as a simple CLI tool that interacts with the Ozon API.

## Architecture

- **index.js**: Main entry point (currently minimal with "hello jeda")
- **config.js**: Ozon API configuration including:
  - API endpoints and authentication
  - Rate limiting settings (200ms delay, 3 max retries)
  - Business logic constants (FBO stock supply days, safety stock days)
  - Regional delivery day mappings for different clusters
- **.env**: Contains Ozon API credentials (CLIENT_ID, API_KEY, BASE_URL)

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

## Configuration

The application uses ozon API: https://docs.ozon.ru/api/seller/

The application uses environment variables for Ozon API configuration:
- `OZON_CLIENT_ID`: Ozon seller client ID
- `OZON_API_KEY`: Ozon API key
- `OZON_BASE_URL`: API base URL (defaults to https://api-seller.ozon.ru)

Rate limiting is configured for 200ms delays between requests with up to 3 retries.

## Business Logic Constants

- FBO stock supply period: 28 days
- FBO safety stock period: 5 days
- Default sales analysis period: 30 days
- Regional delivery days vary by cluster (7-30 days depending on location)

## Code Formatting

The project is configured for consistent 2-space indentation:
- **VS Code settings**: `.vscode/settings.json` configures editor for 2 spaces, format on save using built-in formatters
- **EditorConfig**: `.editorconfig` for cross-editor consistency