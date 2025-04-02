# Periscope - MEV Searcher on TON Blockchain

Periscope is a Maximal Extractable Value (MEV) searcher application for the TON blockchain. It connects to the TON testnet using the SOVA JavaScript SDK, subscribes to mempool updates, provides a web API for monitoring and managing the searcher, and includes a real-time dashboard for visualizing MEV opportunities.

## Features

- Connect to TON testnet using SOVA JS SDK
- Subscribe to mempool updates by workchain or addresses
- Analyze mempool data for MEV opportunities using multiple strategies
- Implement arbitrage and sandwich attack strategies
- Expose a RESTful API using Hono web server
- Real-time dashboard with WebSocket updates via Socket.IO
- Submit bundles to the SOVA API for execution
- Subscribe to bundle results for tracking execution status
- Authenticate with the SOVA service using ED25519 private keys
- Structured logging with Pino
- TypeScript implementation with strict type safety

## Prerequisites

- [Bun](https://bun.sh/) runtime (v1.0.0+)

## Installation

Clone the repository and install dependencies:

```bash
# Install dependencies
bun install
```

## Usage

### Configuration

The application can be configured using environment variables:

```bash
# SOVA API endpoint (default: testnet-engine.sova.network:30020)
SOVA_ENDPOINT=testnet-engine.sova.network:30020

# Disable TLS for SOVA connection (default: true)
SOVA_TLS=true

# Path to ED25519 private key file for SOVA authentication
SOVA_KEY_PATH=./private_key.pem

# Enable verbose gRPC logging for debugging
DEBUG_GRPC=false

# Disable Bun welcome message
BUN_DISABLE_WELCOME=true
```

### Starting the Server

```bash
# Start the server in development mode with auto-reload
bun run dev

# Start the server in production mode
bun run start

# Direct start (recommended)
bun run src/server.ts
```

The server will start on http://localhost:8087 by default, where you can access the dashboard.

### Dashboard

The application includes a real-time dashboard that can be accessed at http://localhost:8087. The dashboard provides:

- Real-time MEV opportunity monitoring
- System health metrics
- DEX activity visualization
- Connection status indicators
- Interactive controls for clearing opportunities

### API Endpoints

#### Health Check
```
GET /health
```
Returns the server status.

Example:
```bash
curl http://localhost:8087/health
```

Response:
```json
{
  "status": "ok",
  "timestamp": "2025-04-02T19:17:04.000Z",
  "uptime": 3600,
  "subscriptions": 1,
  "lastPacketReceived": "2025-04-02T19:16:59.000Z"
}
```

#### Get Latest Mempool Packet
```
GET /mempool
```
Returns the latest mempool packet received.

Example:
```bash
curl http://localhost:8087/mempool
```

Response:
```json
{
  "packet": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "timestamp": 1680320824000,
    "data": { ... }
  },
  "timestamp": "2025-04-01T19:17:04.000Z"
}
```

#### Get Active Subscriptions
```
GET /subscriptions
```
Returns all active mempool subscriptions.

Example:
```bash
curl http://localhost:8087/subscriptions
```

Response:
```json
{
  "subscriptions": ["workchain-0"],
  "count": 1,
  "timestamp": "2025-04-01T19:17:04.000Z"
}
```

#### Start a New Subscription
```
POST /subscribe
```
Starts a new mempool subscription.

Example:
```bash
curl -X POST http://localhost:8087/subscribe \
  -H "Content-Type: application/json" \
  -d '{"type": "workchain", "value": 0}'
```

Response:
```json
{
  "message": "Subscription started: workchain-0",
  "subscriptionId": "workchain-0",
  "timestamp": "2025-04-01T19:17:04.000Z"
}
```

Example with addresses:
```bash
curl -X POST http://localhost:3000/subscribe \
  -H "Content-Type: application/json" \
  -d '{"type": "addresses", "value": ["EQD...abc", "EQD...xyz"]}'
```

#### Stop a Subscription
```
DELETE /subscribe/:id
```
Stops an active subscription.

Example:
```bash
curl -X DELETE http://localhost:8087/subscribe/workchain-0
```

Response:
```json
{
  "message": "Subscription stopped: workchain-0",
  "timestamp": "2025-04-01T19:17:04.000Z"
}
```

#### Get MEV Opportunities
```
GET /opportunities
```
Returns identified MEV opportunities.

Example:
```bash
curl http://localhost:8087/opportunities
```

Response:
```json
{
  "opportunities": [
    {
      "id": "1c6f11f4-5c56-4882-8caf-ce31ab6ebe0c",
      "strategy": "arbitrage",
      "timestamp": 1743562401790,
      "profitEstimate": 1.646814840939741,
      "confidence": 0.8090356795255168,
      "details": {
        "buyDex": "Ston.fi",
        "sellDex": "Megaton",
        "tokenPair": "TON/USDT",
        "priceDifferencePercent": 1.7127009650871963,
        "buyAmount": 97.36583121387189,
        "sellAmount": 99.03341674473704,
        "estimatedProfit": 1.646814840939741,
        "estimatedGas": 0.01577068992541265,
        "executionPlan": "Buy 97.37 on Ston.fi, sell 99.03 on Megaton"
      },
      "rawData": {
        "packetId": "70e2ea6c-f067-4795-b054-fad1c872d52c",
        "timestamp": 1743562401790
      }
    }
  ],
  "count": 1,
  "timestamp": "2025-04-02T02:46:51.923Z"
}
```

#### Get Strategy Statistics
```
GET /strategies
```
Returns statistics about registered MEV strategies.

Example:
```bash
curl http://localhost:8087/strategies
```

Response:
```json
{
  "statistics": {
    "totalStrategies": 2,
    "totalOpportunities": 22,
    "lastAnalysisTime": 1743562415363,
    "strategies": [
      {
        "name": "arbitrage",
        "enabled": true,
        "opportunitiesCount": 12,
        "totalProfit": 17.74013315625847,
        "averageProfit": 1.4783444296882058,
        "config": {
          "enabled": true,
          "minConfidence": 0.7,
          "minProfitEstimate": 0.01,
          "minPriceDifferencePercent": 1,
          "maxSlippage": 0.5,
          "gasBuffer": 0.005,
          "targetPairs": ["TON/USDT", "TON/USDC", "JETTON/TON"],
          "dexes": ["DeDust", "Ston.fi", "Megaton"]
        }
      }
    ]
  },
  "timestamp": "2025-04-02T02:53:38.778Z"
}
```

#### Update Strategy Configuration
```
PATCH /strategies/:name
```
Updates the configuration of a specific MEV strategy.

Example:
```bash
curl -X PATCH http://localhost:8087/strategies/arbitrage \
  -H "Content-Type: application/json" \
  -d '{"enabled": true, "minProfitEstimate": 0.5}'
```

Response:
```json
{
  "message": "Strategy arbitrage configuration updated",
  "strategy": "arbitrage",
  "config": {
    "enabled": true,
    "minConfidence": 0.7,
    "minProfitEstimate": 0.5,
    "minPriceDifferencePercent": 1,
    "maxSlippage": 0.5,
    "gasBuffer": 0.005,
    "targetPairs": ["TON/USDT", "TON/USDC", "JETTON/TON"],
    "dexes": ["DeDust", "Ston.fi", "Megaton"]
  },
  "timestamp": "2025-04-02T02:55:46.637Z"
}
```

#### Clear MEV Opportunities
```
DELETE /opportunities
```
Clears all identified MEV opportunities.

Example:
```bash
curl -X DELETE http://localhost:8087/opportunities
```

Response:
```json
{
  "message": "All opportunities cleared",
  "timestamp": "2025-04-02T02:55:52.667Z"
}
```

## Project Structure

```
periscope/
├── src/
│   ├── client.ts      # SOVA client setup, authentication, and bundle submission
│   ├── searcher.ts    # Mempool subscription logic
│   ├── server.ts      # Hono web server and Socket.IO setup
│   ├── strategies/    # MEV strategy implementations
│   │   ├── base-strategy.ts        # Base strategy interface
│   │   ├── arbitrage-strategy.ts   # Arbitrage strategy implementation
│   │   ├── sandwich-strategy.ts    # Sandwich attack strategy implementation
│   │   └── strategy-manager.ts     # Strategy coordination and management
│   ├── config/        # Configuration files
│   │   └── dex-config.ts           # DEX-specific configuration
│   └── types/         # TypeScript type definitions
│       └── sova-labs.d.ts          # Type declarations for SOVA SDK
├── dashboard/         # Real-time dashboard frontend
│   ├── src/           # Dashboard source code
│   │   ├── components/             # React components
│   │   ├── lib/                    # Utility functions and API client
│   │   └── App.tsx                 # Main dashboard application
│   ├── public/        # Static assets
│   └── index.html     # Dashboard HTML entry point
├── public/            # Static files served by the server
│   └── index.html     # Main dashboard HTML
├── test-connection/   # SOVA connection test utilities
│   ├── test-sova-connection.js     # Basic connection test
│   └── verify-sova-connection.js   # Enhanced connection verification
├── package.json       # Project metadata and scripts
├── tsconfig.json      # TypeScript configuration
├── start.js           # Custom entry point for the server
└── README.md          # Project documentation
```

## MEV Strategies

### Arbitrage Strategy

The Arbitrage Strategy identifies price differences between different decentralized exchanges (DEXes) on the TON blockchain. It looks for opportunities to buy a token on one DEX and sell it on another for a profit.

Configuration parameters:
- `enabled`: Whether the strategy is enabled
- `minConfidence`: Minimum confidence level required (0-1)
- `minProfitEstimate`: Minimum profit required (in TON)
- `minPriceDifferencePercent`: Minimum price difference between DEXes (%)
- `maxSlippage`: Maximum slippage tolerance (%)
- `gasBuffer`: Buffer for gas costs (in TON)
- `targetPairs`: Token pairs to monitor
- `dexes`: DEXes to monitor

### Sandwich Strategy

The Sandwich Strategy identifies opportunities to front-run and back-run large swap transactions. It looks for pending large swaps in the mempool, executes a smaller swap before the target transaction (front-run), and then executes another swap after the target transaction (back-run) to profit from the price impact.

Configuration parameters:
- `enabled`: Whether the strategy is enabled
- `minConfidence`: Minimum confidence level required (0-1)
- `minProfitEstimate`: Minimum profit required (in TON)
- `minTargetSwapSize`: Minimum size of target swap (in TON)
- `maxFrontRunGas`: Maximum gas to spend on front-run (in TON)
- `maxBackRunGas`: Maximum gas to spend on back-run (in TON)
- `targetPairs`: Token pairs to monitor
- `slippageTolerance`: Maximum slippage tolerance (%)

## Extending the Searcher

### Adding New Subscription Types

To add a new subscription type:

1. Add a new method in the `searcher.ts` file:

```typescript
export function subscribeByNewMethod(client: SovaClient, param: ParamType): ClientReadableStream<unknown> {
  logger.info({ param }, "Starting mempool subscription by new method");
  
  const searcher = client.getSearcher();
  const stream = searcher.subscribeByNewMethod(param);
  
  setupStreamHandlers(stream, `new-method-${param}`);
  
  return stream;
}
```

2. Update the `SubscriptionManager` class to support the new subscription type:

```typescript
startSubscription(type: 'workchain' | 'addresses' | 'new-method', value: number | string[] | ParamType): string {
  // Add handling for the new type
  if (type === 'new-method') {
    stream = subscribeByNewMethod(this.client, value as ParamType);
  }
}
```

3. Update the API endpoint in `server.ts` to accept the new subscription type.

### Adding New MEV Strategies

To add a new MEV strategy:

1. Create a new strategy file in the `strategies` directory:

```typescript
import { v4 as uuidv4 } from 'uuid';
import type { MempoolPacket } from "../searcher";
import { BaseStrategy } from "./base-strategy";
import type { MEVOpportunity, StrategyConfig } from "./base-strategy";
import { logger } from "../client";

interface NewStrategyConfig extends StrategyConfig {
  // Add strategy-specific configuration parameters
}

interface NewOpportunityDetails extends Record<string, unknown> {
  // Add strategy-specific opportunity details
}

export class NewStrategy extends BaseStrategy {
  constructor(config: Partial<NewStrategyConfig> = {}) {
    // Create a complete config with defaults
    const fullConfig: NewStrategyConfig = {
      enabled: true,
      minConfidence: 0.7,
      minProfitEstimate: 0.01,
      // Add strategy-specific defaults
      ...config
    };
    
    super("new-strategy-name", fullConfig);
  }

  analyze(packet: MempoolPacket): MEVOpportunity[] {
    if (!this.config.enabled) {
      return [];
    }

    const newOpportunities: MEVOpportunity[] = [];
    
    try {
      // Implement strategy-specific analysis logic
      
      // Create and return opportunities
    } catch (error) {
      logger.error({ 
        error: error instanceof Error ? { 
          message: error.message,
          stack: error.stack,
          name: error.name
        } : String(error),
        strategy: this.name 
      }, "Error analyzing mempool packet");
    }
    
    return newOpportunities;
  }
}
```

2. Register the new strategy in the `StrategyManager` class:

```typescript
// Import the new strategy
import { NewStrategy } from "./new-strategy";

private registerDefaultStrategies(): void {
  // Register existing strategies
  this.registerStrategy(new ArbitrageStrategy());
  this.registerStrategy(new SandwichStrategy());
  
  // Register the new strategy
  this.registerStrategy(new NewStrategy());
}
```

## SOVA API Integration

### Bundle Submission

The application integrates with the SOVA API to submit bundles of messages for execution. This is done through the `SovaClientWrapper` class in `client.ts`, which provides the following functionality:

- **Authentication**: Authenticates with the SOVA service using an ED25519 private key.
- **Bundle Results Subscription**: Sets up a subscription to receive updates on the results of submitted bundles.
- **Fetching Tip Addresses**: Retrieves the list of required tip addresses for bundle submissions.
- **Sending Bundles**: Implements functionality to send bundles of messages to the SOVA service.

### Bundle Submission API Endpoints

#### Submit Bundle
```
POST /bundles
```
Submits a bundle of messages to the SOVA API for execution.

Example:
```bash
curl -X POST http://localhost:8087/bundles \
  -H "Content-Type: application/json" \
  -d '{
    "messages": ["base64EncodedMessage1", "base64EncodedMessage2"],
    "expirationMs": 60000
  }'
```

Response:
```json
{
  "bundleId": "550e8400-e29b-41d4-a716-446655440000",
  "messageCount": 2,
  "timestamp": "2025-04-02T19:17:04.000Z"
}
```

#### Get Bundle Results
```
GET /bundles/:id
```
Returns the results of a previously submitted bundle.

Example:
```bash
curl http://localhost:8087/bundles/550e8400-e29b-41d4-a716-446655440000
```

Response:
```json
{
  "bundleId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "executed",
  "executedAt": "2025-04-02T19:17:10.000Z",
  "results": {
    "successCount": 2,
    "failureCount": 0,
    "details": [...]
  },
  "timestamp": "2025-04-02T19:17:15.000Z"
}
```

#### Get Tip Addresses
```
GET /tip-addresses
```
Returns the list of tip addresses required for bundle submissions.

Example:
```bash
curl http://localhost:8087/tip-addresses
```

Response:
```json
{
  "addresses": [
    "EQD...",
    "EQD..."
  ],
  "timestamp": "2025-04-02T19:17:04.000Z"
}
```

## Notes

- The private key for authentication with the SOVA service is read from a file at `./private_key.pem`. Make sure this file exists and contains a valid ED25519 private key.
- The application will continue to function for mempool subscriptions even if authentication with the SOVA service fails.
- MEV strategies are simulated for demonstration purposes. In a production environment, you would implement more sophisticated analysis and execution logic.
- The dashboard provides real-time visualization of MEV opportunities and system health metrics.
