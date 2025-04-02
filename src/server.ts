/**
 * Hono web server for the Periscope MEV searcher
 * Provides endpoints for monitoring and managing the searcher
 */
import { Hono } from "hono";
import { logger as honoLogger } from "hono/logger";
import { cors } from "hono/cors";
import { Server } from "socket.io";
import { serveStatic } from "@hono/node-server/serve-static";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { initializeClient, logger } from "./client";
import { SubscriptionManager, getLatestPacket, getStrategyManager, getLatestOpportunities } from "./searcher";
import type { MEVOpportunity } from "./strategies/base-strategy";
import { createServer } from 'http';
import crypto from 'crypto';

// Get directory paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const publicPath = join(__dirname, "../public");

// Initialize the SOVA client
const client = initializeClient();

// Create subscription manager
const subscriptionManager = new SubscriptionManager(client);

// Start the subscription with proper error handling
try {
  logger.info("Starting mempool subscription for workchain 0");
  subscriptionManager.startSubscription('workchain', 0);
} catch (error) {
  logger.error({ error }, "Failed to start mempool subscription");
  // Don't exit, let the server continue running
}

// Create Hono app
const app = new Hono();

// Add middleware
app.use("*", honoLogger());
app.use("*", cors());

// Serve static files from the public directory
app.use("/*", serveStatic({ root: publicPath }));

// Define routes
app.get("/", (c) => {
  // Serve the index.html file directly
  return c.html(Bun.file(join(publicPath, "index.html")).text());
});

// Dashboard route
app.get("/dashboard", (c) => {
  // Redirect to root since that's where our dashboard is now
  return c.redirect("/");
});

// Health check endpoint with improved connection status
app.get('/health', (c) => {
  const uptime = process.uptime();
  const lastPacketTime = getLatestPacket()?.timestamp || 0;
  const timeSinceLastPacket = lastPacketTime ? Date.now() - lastPacketTime : null;
  const activeSubscriptions = subscriptionManager.getActiveSubscriptions();
  
  // Determine connection status based on multiple factors
  let connectionStatus = 'unknown';
  if (timeSinceLastPacket === null) {
    connectionStatus = 'no_data';
  } else if (timeSinceLastPacket < 60000) {
    connectionStatus = 'connected';
  } else if (timeSinceLastPacket < 300000) { // 5 minutes
    connectionStatus = 'degraded';
  } else {
    connectionStatus = 'disconnected';
  }
  
  return c.json({
    status: 'ok',
    uptime: Math.floor(uptime),
    lastPacketReceived: lastPacketTime ? new Date(lastPacketTime).toISOString() : null,
    timeSinceLastPacketMs: timeSinceLastPacket,
    activeSubscriptions: activeSubscriptions || [],
    connectionStatus,
    timestamp: new Date().toISOString()
  });
});

// Get latest mempool packet endpoint
app.get("/mempool", (c) => {
  logger.info("Mempool data requested");
  const packet = getLatestPacket();
  return c.json({ 
    packet: packet || { message: "No mempool data received yet" },
    timestamp: new Date().toISOString()
  });
});

// Get active subscriptions endpoint
app.get("/subscriptions", (c) => {
  logger.info("Active subscriptions requested");
  const activeSubscriptions = subscriptionManager.getActiveSubscriptions();
  return c.json({ 
    subscriptions: activeSubscriptions,
    count: activeSubscriptions.length,
    timestamp: new Date().toISOString()
  });
});

// Start a new subscription endpoint
app.post("/subscribe", async (c) => {
  try {
    const { type, value } = await c.req.json<{ type: 'workchain' | 'addresses', value: number | string[] }>();
    
    logger.info({ type, value }, "Subscription request received");
    
    // Validate request
    if (!type || !value) {
      logger.warn({ type, value }, "Invalid subscription request");
      return c.json({ error: "Invalid request. Required: type and value" }, 400);
    }
    
    if (type !== 'workchain' && type !== 'addresses') {
      logger.warn({ type }, "Invalid subscription type");
      return c.json({ error: "Invalid subscription type. Must be 'workchain' or 'addresses'" }, 400);
    }
    
    // Start subscription
    const subscriptionId = subscriptionManager.startSubscription(type, value);
    
    return c.json({ 
      message: `Subscription started: ${subscriptionId}`,
      subscriptionId,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error({ error }, "Error processing subscription request");
    return c.json({ error: "Invalid request format" }, 400);
  }
});

// Stop a subscription endpoint
app.delete("/subscribe/:id", (c) => {
  const subscriptionId = c.req.param("id");
  logger.info({ subscriptionId }, "Subscription stop request received");
  
  const success = subscriptionManager.stopSubscription(subscriptionId);
  
  if (success) {
    return c.json({ 
      message: `Subscription stopped: ${subscriptionId}`,
      timestamp: new Date().toISOString()
    });
  } else {
    return c.json({ 
      error: `Subscription not found: ${subscriptionId}` 
    }, 404);
  }
});

// Get MEV opportunities endpoint
app.get("/opportunities", (c) => {
  const limitParam = c.req.query("limit");
  const strategy = c.req.query("strategy");
  
  const limit = limitParam ? parseInt(limitParam, 10) : 10;
  
  logger.info({ limit, strategy }, "MEV opportunities requested");
  
  const opportunities = getLatestOpportunities(limit, strategy || undefined);
  
  return c.json({
    opportunities,
    count: opportunities.length,
    timestamp: new Date().toISOString()
  });
});

// Get MEV strategy statistics endpoint
app.get("/strategies", (c) => {
  logger.info("MEV strategy statistics requested");
  
  const strategyManager = getStrategyManager();
  const strategies = strategyManager.getStrategies();
  
  return c.json({
    strategies,
    timestamp: new Date().toISOString()
  });
});

// Update strategy configuration endpoint
app.patch("/strategies/:name", async (c) => {
  try {
    const strategyName = c.req.param("name");
    const config = await c.req.json();
    
    logger.info({ strategyName, config }, "Strategy configuration update requested");
    
    const strategyManager = getStrategyManager();
    const strategy = strategyManager.getStrategy(strategyName);
    
    if (!strategy) {
      return c.json({ error: `Strategy not found: ${strategyName}` }, 404);
    }
    
    strategyManager.updateStrategyConfig(strategyName, config);
    
    return c.json({
      message: `Strategy ${strategyName} configuration updated`,
      strategy: strategyName,
      config: strategy.getConfig(),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error({ error }, "Error updating strategy configuration");
    return c.json({ error: "Invalid request format" }, 400);
  }
});

// Clear opportunities endpoint
app.delete("/opportunities", async (c) => {
  const strategy = c.req.query("strategy");
  
  logger.info({ strategy }, "Clear opportunities requested");
  
  const strategyManager = getStrategyManager();
  strategyManager.clearOpportunities(strategy || undefined);
  
  return c.json({
    message: strategy ? `Opportunities cleared for strategy: ${strategy}` : "All opportunities cleared",
    timestamp: new Date().toISOString()
  });
});

// System stats endpoint
app.get("/system/stats", (c) => {
  logger.info("System stats requested");
  
  const startTime = process.uptime();
  const activeSubscriptions = subscriptionManager.getActiveSubscriptions();
  const packet = getLatestPacket();
  
  // Calculate DEX activity from real opportunities only
  const opportunities = getLatestOpportunities(100);
  let mempoolStats: Record<string, number> = {};
  
  opportunities.forEach(opp => {
    if (opp.strategy === 'arbitrage') {
      const buyDex = opp.details.buyDex as string;
      const sellDex = opp.details.sellDex as string;
      
      if (buyDex) {
        mempoolStats[buyDex] = (mempoolStats[buyDex] || 0) + 1;
      }
      
      if (sellDex) {
        mempoolStats[sellDex] = (mempoolStats[sellDex] || 0) + 1;
      }
    }
  });
  
  return c.json({
    uptime: startTime,
    lastPacketReceived: packet?.timestamp || Date.now(),
    activeSubscriptions: activeSubscriptions,
    mempoolStats,
    timestamp: new Date().toISOString()
  });
});

// Setup graceful shutdown
process.on('SIGINT', () => {
  logger.info("Shutting down Periscope...");
  subscriptionManager.stopAllSubscriptions();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info("Shutting down Periscope...");
  subscriptionManager.stopAllSubscriptions();
  process.exit(0);
});

// Use Node.js server with Socket.IO support
const port = process.env.PORT ? parseInt(process.env.PORT) : 8087;

// Create a simple HTTP server instead of using Bun's built-in server
const httpServer = createServer((req, res) => {
  // Forward the request to Hono
  const promise = app.fetch(new Request(new URL(req.url || '/', `http://${req.headers.host}`), {
    method: req.method,
    headers: req.headers as HeadersInit,
  }));
  
  // Use async/await to handle the promise properly
  (async () => {
    try {
      const honoRes = await promise;
      
      // Set status code
      res.statusCode = honoRes.status;
      
      // Set headers
      honoRes.headers.forEach((value: string, key: string) => {
        res.setHeader(key, value);
      });
      
      // Send body
      const buffer = await honoRes.arrayBuffer();
      res.end(Buffer.from(buffer));
    } catch (error) {
      logger.error({ error }, "Error handling HTTP request");
      res.statusCode = 500;
      res.end("Internal Server Error");
    }
  })();
});

httpServer.listen(port, () => {
  logger.info(`Periscope running on http://localhost:${port}`);
});

// Setup Socket.IO with the HTTP server
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// WebSocket event handlers
io.on('connection', (socket) => {
  logger.info({ socketId: socket.id }, "WebSocket client connected");
  
  // Send initial data
  const opportunities = getLatestOpportunities(20);
  socket.emit('opportunities', opportunities);
  
  // Handle disconnection
  socket.on('disconnect', () => {
    logger.info({ socketId: socket.id }, "WebSocket client disconnected");
  });
});

// Setup opportunity broadcasting
const strategyManager = getStrategyManager();
strategyManager.on('opportunitiesUpdated', (opportunities: MEVOpportunity[]) => {
  io.emit('opportunities', opportunities);
});

// Broadcast system stats every 5 seconds
setInterval(() => {
  const startTime = process.uptime();
  const activeSubscriptions = subscriptionManager.getActiveSubscriptions();
  const packet = getLatestPacket();
  
  // Calculate DEX activity from real opportunities only
  const opportunities = getLatestOpportunities(100);
  let mempoolStats: Record<string, number> = {};
  
  opportunities.forEach(opp => {
    if (opp.strategy === 'arbitrage') {
      const buyDex = opp.details.buyDex as string;
      const sellDex = opp.details.sellDex as string;
      
      if (buyDex) {
        mempoolStats[buyDex] = (mempoolStats[buyDex] || 0) + 1;
      }
      
      if (sellDex) {
        mempoolStats[sellDex] = (mempoolStats[sellDex] || 0) + 1;
      }
    }
  });
  
  // Send system stats with proper numeric values
  io.emit('systemStats', {
    uptime: startTime || 0,
    lastPacketReceived: packet?.timestamp || Date.now(),
    activeSubscriptions: activeSubscriptions || 0,
    mempoolStats,
    timestamp: new Date().toISOString()
  });
}, 5000);