/**
 * Mempool subscription logic for the Periscope MEV searcher
 * Handles subscribing to mempool updates and processing the received packets
 */
import type { SovaClient } from "@sova-labs/sdk";
import type { ClientReadableStream } from "@grpc/grpc-js";
import { logger } from "./client";
import { StrategyManager } from "./strategies/strategy-manager";
import type { MEVOpportunity } from "./strategies/base-strategy";
import crypto from 'crypto';

/**
 * Interface for mempool packet data structure
 */
export interface MempoolPacket {
  id: string;
  timestamp: number;
  data: any;
  transactions?: any[];
}

// Store the latest mempool packet for API access
let latestPacket: MempoolPacket | null = null;

// Initialize the strategy manager
const strategyManager = new StrategyManager();

// Store identified MEV opportunities
let latestOpportunities: MEVOpportunity[] = [];

// Cache for processed transactions to avoid duplicates
const processedTransactions = new Set<string>();

/**
 * Get the latest mempool packet
 * @returns The latest mempool packet or null if none received
 */
export function getLatestPacket(): MempoolPacket | null {
  return latestPacket;
}

/**
 * Get the strategy manager instance
 * @returns The strategy manager
 */
export function getStrategyManager(): StrategyManager {
  return strategyManager;
}

/**
 * Get the latest MEV opportunities
 * @param limit Maximum number of opportunities to return (0 for all)
 * @param strategyFilter Optional filter by strategy name
 * @returns Array of identified opportunities
 */
export function getLatestOpportunities(limit = 0, strategyFilter?: string): MEVOpportunity[] {
  return strategyManager.getOpportunities(limit, strategyFilter);
}

/**
 * Subscribe to mempool updates for a specific workchain
 * @param client Authenticated SovaClient instance
 * @param workchain Workchain ID to subscribe to (default: 0)
 * @returns Stream for the subscription
 */
export function subscribeByWorkchain(client: SovaClient, workchain: number = 0): ClientReadableStream<unknown> {
  logger.info({ workchain }, "Starting mempool subscription by workchain");
  
  const searcher = client.getSearcher();
  const stream = searcher.subscribeByWorkchain(workchain);
  
  setupStreamHandlers(stream, `workchain-${workchain}`, client);
  
  return stream;
}

/**
 * Subscribe to mempool updates for specific addresses
 * @param client Authenticated SovaClient instance
 * @param addresses Array of TON addresses to monitor
 * @returns Stream for the subscription
 */
export function subscribeByAddresses(client: SovaClient, addresses: string[]): ClientReadableStream<unknown> {
  logger.info({ addresses }, "Starting mempool subscription by addresses");
  
  const searcher = client.getSearcher();
  const stream = searcher.subscribeByAddresses(addresses);
  
  setupStreamHandlers(stream, `addresses-${addresses.join(',')}`, client);
  
  return stream;
}

/**
 * Set up event handlers for a subscription stream
 * @param stream Stream to set up handlers for
 * @param subscriptionId Identifier for the subscription (for logging)
 * @param sovaClient The SOVA client instance to use for reconnections
 */
function setupStreamHandlers(
  stream: ClientReadableStream<unknown>,
  subscriptionId: string,
  sovaClient: SovaClient
): void {
  let retryCount = 0;
  const maxRetries = 10; // Increased from 5 to 10
  const baseRetryDelay = 5000; // 5 seconds
  const maxRetryDelay = 60000; // 1 minute max delay
  let isConnected = false;
  let reconnectionTimer: NodeJS.Timeout | null = null;
  
  // Function to handle reconnection with exponential backoff
  const reconnect = () => {
    if (reconnectionTimer) {
      clearTimeout(reconnectionTimer);
      reconnectionTimer = null;
    }
    
    if (retryCount >= maxRetries) {
      logger.error({ subscriptionId, retryCount, maxRetries }, "Max retries reached for subscription");
      
      // After max retries, try again with a longer interval
      logger.info({ subscriptionId }, "Scheduling periodic reconnection attempt every minute");
      reconnectionTimer = setTimeout(() => {
        logger.info({ subscriptionId }, "Periodic reconnection attempt");
        retryCount = 0; // Reset retry count for a fresh attempt
        reconnect();
      }, 60000); // Try again after 1 minute
      
      return;
    }
    
    retryCount++;
    // Exponential backoff with jitter and max cap
    const jitter = Math.random() * 0.3 + 0.85; // Random between 0.85 and 1.15
    const delay = Math.min(baseRetryDelay * Math.pow(1.5, retryCount - 1) * jitter, maxRetryDelay);
    
    logger.info({ 
      subscriptionId, 
      retryCount, 
      maxRetries, 
      delayMs: Math.round(delay) 
    }, "Attempting reconnection with exponential backoff");
    
    reconnectionTimer = setTimeout(() => {
      try {
        if (subscriptionId.startsWith('workchain-')) {
          const workchain = parseInt(subscriptionId.replace('workchain-', ''), 10);
          subscribeByWorkchain(sovaClient, workchain);
        } else if (subscriptionId.startsWith('addresses-')) {
          const addresses = subscriptionId.replace('addresses-', '').split(',');
          subscribeByAddresses(sovaClient, addresses);
        } else {
          logger.warn({ subscriptionId }, "Unknown subscription type, cannot reconnect");
        }
      } catch (error) {
        logger.error({ error, subscriptionId }, "Error during reconnection attempt");
        // Continue with reconnection attempts
        reconnect();
      }
    }, delay);
  };
  
  // Add ping/health check to detect dead connections
  const pingInterval = 30000; // 30 seconds
  let pingTimer: NodeJS.Timeout | null = null;
  let lastDataTimestamp = Date.now();
  
  const startPingCheck = () => {
    if (pingTimer) {
      clearInterval(pingTimer);
    }
    
    pingTimer = setInterval(() => {
      const now = Date.now();
      // If we haven't received data in 2 minutes, consider the connection dead
      if (now - lastDataTimestamp > 120000 && isConnected) {
        logger.warn({ 
          subscriptionId, 
          lastDataMs: now - lastDataTimestamp 
        }, "No data received for too long, connection might be dead");
        
        isConnected = false;
        if (pingTimer) {
          clearInterval(pingTimer);
          pingTimer = null;
        }
        
        // Force reconnection
        reconnect();
      }
    }, pingInterval);
  };
  
  startPingCheck();
  
  stream.on("data", (data) => {
    isConnected = true;
    lastDataTimestamp = Date.now();
    retryCount = 0; // Reset retry count on successful data reception
    
    try {
      // Parse the data if it's a string
      const packet = typeof data === 'string' ? JSON.parse(data) : data;
      
      // Extract useful information for logging
      const serverTime = new Date(Number(packet.serverTs.seconds) * 1000).toISOString();
      const expirationMs = Math.floor(packet.expirationNs / 1000000);
      const messageCount = {
        external: packet.externalMessages?.length || 0,
        internal: packet.messages?.length || 0
      };
      
      // Log in a more readable format
      logger.info({
        subscriptionId,
        serverTime,
        expiresIn: `${(expirationMs / 1000).toFixed(2)}s`,
        messages: `${messageCount.external} external, ${messageCount.internal} internal`
      }, "Mempool update received");
      
      // Process the packet
      processMempoolPacket({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        data: packet
      });
      
    } catch (error) {
      logger.error({ error, subscriptionId }, "Error processing mempool data");
    }
  });
  
  stream.on("error", (error) => {
    logger.error({ subscriptionId, error }, "Mempool subscription stream error");
    isConnected = false;
    // Try to reconnect on error
    reconnect();
  });
  
  stream.on("status", (status) => {
    logger.info({ subscriptionId, status }, "Mempool subscription stream status update");
    
    // If we get a non-OK status, try to reconnect
    if (status.code !== 0) {
      logger.warn({ subscriptionId, statusCode: status.code }, "Non-OK status received, attempting reconnect");
      isConnected = false;
      reconnect();
    }
  });
  
  // Clean up function to be called when subscription is stopped
  (stream as any).cleanup = () => {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
    
    if (reconnectionTimer) {
      clearTimeout(reconnectionTimer);
      reconnectionTimer = null;
    }
    
    logger.info({ subscriptionId }, "Cleaned up subscription resources");
  };
}

/**
 * Extract transactions from a mempool packet
 * @param packet Mempool packet to extract transactions from
 * @returns Array of transactions
 */
export function extractTransactionsFromPacket(packet: MempoolPacket): any[] {
  try {
    // Check if the packet already has extracted transactions
    if (packet.transactions && Array.isArray(packet.transactions)) {
      return packet.transactions;
    }
    
    // Check if the packet has a data field with transactions
    if (packet.data) {
      const data = packet.data as Record<string, any>;
      
      // Check for transactions array
      if (data.transactions && Array.isArray(data.transactions)) {
        return data.transactions;
      }
      
      // Check for messages array (alternative format)
      if (data.messages && Array.isArray(data.messages)) {
        return data.messages;
      }
      
      // Check if data itself is an array
      if (Array.isArray(data)) {
        return data;
      }
      
      // Check for external messages
      if (data.externalMessages && Array.isArray(data.externalMessages)) {
        return data.externalMessages;
      }
    }
    
    return [];
  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : String(error),
      packetId: packet.id
    }, "Error extracting transactions from packet");
    return [];
  }
}

/**
 * Process a mempool packet and extract transactions
 * @param packet Mempool packet to process
 */
export function processMempoolPacket(packet: MempoolPacket): void {
  try {
    // Update latest packet
    latestPacket = packet;
    
    // Extract transactions
    const transactions = extractTransactionsFromPacket(packet);
    
    // Process each transaction
    for (const tx of transactions) {
      // Skip if we've already processed this transaction
      const txHash = tx.hash?.toString('hex') || JSON.stringify(tx);
      if (processedTransactions.has(txHash)) {
        continue;
      }
      
      // Add to processed set
      processedTransactions.add(txHash);
      
      // Add transactions to packet for strategy analysis
      packet.transactions = transactions;
      
      // Analyze with strategies
      const opportunities = strategyManager.analyzePacket(packet);
      if (opportunities.length > 0) {
        latestOpportunities = [...latestOpportunities, ...opportunities];
      }
    }
    
    // Clean up old processed transactions (keep last 1000)
    if (processedTransactions.size > 1000) {
      const oldTransactions = Array.from(processedTransactions).slice(0, processedTransactions.size - 1000);
      oldTransactions.forEach(tx => processedTransactions.delete(tx));
    }
  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : String(error),
      packetId: packet.id
    }, "Error processing mempool packet");
  }
}

/**
 * Manages active subscription streams
 */
export class SubscriptionManager {
  private streams: Map<string, ClientReadableStream<any>> = new Map();
  private latestPacket: MempoolPacket | null = null;
  private strategyManager: StrategyManager;

  constructor(private client: any) {
    this.strategyManager = getStrategyManager();
  }
  
  /**
   * Start a new subscription
   * @param type Type of subscription ('workchain' or 'addresses')
   * @param value Value for the subscription (workchain ID or array of addresses)
   * @returns ID of the created subscription
   */
  startSubscription(type: 'workchain' | 'addresses', value: number | string[]): string {
    const subscriptionId = `${type}-${typeof value === 'number' ? value : (value as string[]).join(',')}`;
    
    // Check if subscription already exists
    if (this.streams.has(subscriptionId)) {
      logger.warn({ subscriptionId }, "Subscription already exists");
      return subscriptionId;
    }
    
    let stream: ClientReadableStream<unknown>;
    
    if (type === 'workchain') {
      stream = subscribeByWorkchain(this.client, value as number);
    } else {
      stream = subscribeByAddresses(this.client, value as string[]);
    }
    
    this.streams.set(subscriptionId, stream);
    logger.info({ subscriptionId }, "Subscription started and registered");
    
    return subscriptionId;
  }
  
  /**
   * Stop a subscription by ID
   * @param subscriptionId ID of the subscription to stop
   * @returns Whether the subscription was successfully stopped
   */
  stopSubscription(subscriptionId: string): boolean {
    const stream = this.streams.get(subscriptionId);
    
    if (!stream) {
      logger.warn({ subscriptionId }, "Subscription not found");
      return false;
    }
    
    stream.cancel();
    this.streams.delete(subscriptionId);
    logger.info({ subscriptionId }, "Subscription stopped and unregistered");
    
    // Clean up subscription resources
    if ((stream as any).cleanup) {
      (stream as any).cleanup();
    }
    
    return true;
  }
  
  /**
   * Stop all active subscriptions
   */
  stopAllSubscriptions(): void {
    for (const [subscriptionId, stream] of this.streams.entries()) {
      stream.cancel();
      logger.info({ subscriptionId }, "Subscription stopped");
      
      // Clean up subscription resources
      if ((stream as any).cleanup) {
        (stream as any).cleanup();
      }
    }
    
    this.streams.clear();
    logger.info("All subscriptions stopped");
  }
  
  /**
   * Get all active subscription IDs
   * @returns Array of active subscription IDs
   */
  getActiveSubscriptions(): string[] {
    return Array.from(this.streams.keys());
  }

  private handleMempoolData(subscriptionId: string, data: any) {
    try {
      // Parse the data if it's a string
      const packet = typeof data === 'string' ? JSON.parse(data) : data;
      
      // Store the latest packet
      this.latestPacket = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        data: packet
      };
      
      // Extract useful information for logging
      const serverTime = new Date(Number(packet.serverTs.seconds) * 1000).toISOString();
      const expirationMs = Math.floor(packet.expirationNs / 1000000);
      const messageCount = {
        external: packet.externalMessages?.length || 0,
        internal: packet.messages?.length || 0
      };
      
      // Log in a more readable format
      logger.info({
        subscriptionId,
        serverTime,
        expiresIn: `${(expirationMs / 1000).toFixed(2)}s`,
        messages: `${messageCount.external} external, ${messageCount.internal} internal`
      }, "Mempool update received");
      
      // Process the packet with the strategy manager
      this.strategyManager.analyzePacket(this.latestPacket);
      
    } catch (error) {
      logger.error({ error, subscriptionId }, "Error processing mempool data");
    }
  }
}
