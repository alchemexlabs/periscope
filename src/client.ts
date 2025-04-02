/**
 * SOVA client setup and authentication for the Periscope MEV searcher
 * Initializes connection to TON testnet and handles authentication
 * Provides methods for interacting with the SOVA API
 */
import { getTestnetClient } from "@sova-labs/sdk";
import type { SovaClient } from "@sova-labs/sdk";
import type { ClientReadableStream } from "@grpc/grpc-js";
import pino from "pino";
import * as fs from "node:fs";
import * as path from "node:path";
import { EventEmitter } from "events";

// Setup logger
export const logger = pino({
  level: "info",
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
    },
  },
});

/**
 * Extracts the raw ED25519 private key from a PEM file
 * The PEM format for ED25519 private keys typically contains ASN.1 DER encoded data
 * We need to extract just the 32-byte private key
 * 
 * @param pemContent The content of the PEM file
 * @returns Buffer containing the 32-byte ED25519 private key
 */
function extractPrivateKeyFromPEM(pemContent: Buffer): Buffer {
  try {
    // Convert buffer to string and remove headers, footers, and newlines
    const pemString = pemContent.toString('utf8');
    const base64Content = pemString
      .replace('-----BEGIN PRIVATE KEY-----', '')
      .replace('-----END PRIVATE KEY-----', '')
      .replace(/\s/g, '');
    
    // Decode base64 to get the ASN.1 DER encoded key
    const derBuffer = Buffer.from(base64Content, 'base64');
    
    // For ED25519 keys in PKCS#8 format, the private key is typically at a specific offset
    // This is a simplified extraction - in production, proper ASN.1 parsing should be used
    
    // The private key is typically after the OID for ED25519 (06 03 2B 65 70)
    // We'll search for this pattern and extract the key that follows
    let keyStart = -1;
    for (let i = 0; i < derBuffer.length - 5; i++) {
      if (
        derBuffer[i] === 0x06 && 
        derBuffer[i + 1] === 0x03 && 
        derBuffer[i + 2] === 0x2B && 
        derBuffer[i + 3] === 0x65 && 
        derBuffer[i + 4] === 0x70
      ) {
        // Found the OID for ED25519, the key should be a few bytes after
        // Typically there's an OCTET STRING tag (04) followed by length (20 for 32 bytes)
        for (let j = i + 5; j < derBuffer.length - 2; j++) {
          if (derBuffer[j] === 0x04 && derBuffer[j + 1] === 0x20) {
            keyStart = j + 2;
            break;
          }
        }
        break;
      }
    }
    
    if (keyStart !== -1 && keyStart + 32 <= derBuffer.length) {
      logger.info({ keyStart }, "Found private key at offset in DER structure");
      return derBuffer.slice(keyStart, keyStart + 32);
    }
    
    // Fallback: if we couldn't find the key at the expected location,
    // try to extract the last 32 bytes which often contains the key
    if (derBuffer.length >= 32) {
      logger.warn("Could not find key at expected location, using last 32 bytes as fallback");
      return derBuffer.slice(derBuffer.length - 32);
    }
    
    throw new Error('Could not extract ED25519 private key from PEM');
  } catch (error) {
    logger.error({ error }, "Error extracting private key from PEM");
    return Buffer.from([]);
  }
}

/**
 * Reads and processes the private key from the file system
 * Supports multiple key file formats including PEM and raw key files
 * @returns Buffer containing the 32-byte ED25519 private key
 */
function readPrivateKey(): Buffer {
  try {
    // Try multiple possible key file paths
    const possibleKeyPaths = [
      path.resolve(process.cwd(), 'private_key.pem'),
      path.resolve(process.cwd(), 'sova-key.pem'),
      path.resolve(process.cwd(), 'sova-private.key')
    ];
    
    // Use environment variable if provided
    const envKeyPath = process.env.SOVA_KEY_PATH;
    if (envKeyPath) {
      possibleKeyPaths.unshift(path.resolve(envKeyPath));
    }
    
    // Find the first key file that exists
    let keyPath = '';
    let keyFileExists = false;
    
    for (const path of possibleKeyPaths) {
      if (fs.existsSync(path)) {
        keyPath = path;
        keyFileExists = true;
        break;
      }
    }
    
    if (!keyFileExists) {
      logger.warn("No private key file found in any of the expected locations");
      return Buffer.from([]);
    }
    
    logger.info({ keyPath }, "Reading private key from file");
    const fileContent = fs.readFileSync(keyPath);
    
    // Check if this is a PEM file or raw key file
    const contentStr = fileContent.toString('utf8').trim();
    
    if (contentStr.includes('-----BEGIN') && contentStr.includes('PRIVATE KEY-----')) {
      // This is a PEM file
      logger.info("PEM file read successfully, extracting ED25519 key");
      return extractPrivateKeyFromPEM(fileContent);
    } else if (fileContent.length === 32) {
      // This might be a raw 32-byte key file
      logger.info("Raw 32-byte key file detected");
      return fileContent;
    } else if (fileContent.length === 64 && /^[0-9a-fA-F]+$/.test(contentStr)) {
      // This might be a hex-encoded 32-byte key
      logger.info("Hex-encoded key file detected");
      return Buffer.from(contentStr, 'hex');
    } else {
      // Try to extract key from other formats or use as-is if it's 32 bytes
      logger.warn("Unknown key format, attempting to use as raw key");
      return fileContent.length === 32 ? fileContent : Buffer.from([]);
    }
  } catch (error) {
    logger.error({ error }, "Error reading private key");
    return Buffer.from([]);
  }
}

/**
 * Initializes and authenticates a SOVA client for the TON testnet
 * @returns Authenticated SovaClient instance
 */
/**
 * Enhanced SOVA client wrapper that provides additional functionality
 * and event handling for the SOVA API
 */
export class SovaClientWrapper extends EventEmitter {
  private client: SovaClient;
  private bundleResultsStream: ClientReadableStream<unknown> | null = null;
  private tipAddresses: string[] = [];
  private authenticated: boolean = false;
  
  /**
   * Create a new SOVA client wrapper
   * @param client Initialized SOVA client
   */
  constructor(client: SovaClient) {
    super();
    this.client = client;
    this.setupBundleResultsSubscription();
    this.fetchTipAddresses();
  }
  
  /**
   * Get the underlying SOVA client
   * @returns SOVA client instance
   */
  getClient(): SovaClient {
    return this.client;
  }
  
  /**
   * Get the searcher instance from the client
   * @returns Searcher instance
   */
  getSearcher(): any {
    return this.client.getSearcher();
  }
  
  /**
   * Check if the client is authenticated
   * @returns Whether the client is authenticated
   */
  isAuthenticated(): boolean {
    return this.authenticated;
  }
  
  /**
   * Authenticate with the SOVA service
   * @param privateKey ED25519 private key as a Buffer
   * @returns Promise that resolves when authentication is complete
   */
  async authenticate(privateKey: Buffer): Promise<void> {
    try {
      await this.client.authenticate(privateKey);
      this.authenticated = true;
      this.emit('authenticated');
      logger.info("SOVA client authenticated successfully");
    } catch (err) {
      this.authenticated = false;
      this.emit('authenticationFailed', err);
      throw err;
    }
  }
  
  /**
   * Set up subscription to bundle results
   * This allows tracking the outcome of submitted bundles
   */
  private setupBundleResultsSubscription(): void {
    try {
      const searcher = this.getSearcher();
      if (!searcher) {
        logger.warn("Could not get searcher for bundle results subscription");
        return;
      }
      
      // Only set up subscription if the searcher has the method
      if (typeof searcher.subscribeBundleResults === 'function') {
        this.bundleResultsStream = searcher.subscribeBundleResults({});
      
      this.bundleResultsStream?.on('data', (result: any) => {
        logger.info({ bundleId: result.id }, "Received bundle result");
        this.emit('bundleResult', result);
      });
      
      this.bundleResultsStream?.on('error', (error: Error) => {
        logger.error({ error: error.message }, "Bundle results subscription error");
        this.emit('bundleResultsError', error);
        
        // Attempt to reconnect after a delay
        setTimeout(() => {
          logger.info("Attempting to reconnect bundle results subscription");
          this.setupBundleResultsSubscription();
        }, 5000);
      });
      
      this.bundleResultsStream?.on('end', () => {
        logger.warn("Bundle results subscription ended");
        this.emit('bundleResultsEnded');
        
        // Attempt to reconnect after a delay
        setTimeout(() => {
          logger.info("Attempting to reconnect bundle results subscription");
          this.setupBundleResultsSubscription();
        }, 5000);
      });
      
      logger.info("Bundle results subscription established");
      } else {
        logger.warn("subscribeBundleResults method not available on searcher");
      }
    } catch (error) {
      logger.error({ error }, "Failed to set up bundle results subscription");
    }
  }
  
  /**
   * Fetch tip addresses from the SOVA service
   * These addresses are required for bundle submissions
   */
  async fetchTipAddresses(): Promise<string[]> {
    try {
      const searcher = this.getSearcher();
      if (!searcher) {
        logger.warn("Could not get searcher for tip addresses");
        return [];
      }
      
      // Only fetch tip addresses if the searcher has the method
      if (typeof searcher.getTipAddresses === 'function') {
        const response = await searcher.getTipAddresses({});
        this.tipAddresses = response.address || [];
        
        logger.info({ tipAddresses: this.tipAddresses }, "Fetched tip addresses");
        this.emit('tipAddressesFetched', this.tipAddresses);
        
        return this.tipAddresses;
      } else {
        logger.warn("getTipAddresses method not available on searcher");
        return [];
      }
    } catch (error) {
      logger.error({ error }, "Failed to fetch tip addresses");
      return [];
    }
  }
  
  /**
   * Get the cached tip addresses
   * @returns Array of tip addresses
   */
  getTipAddresses(): string[] {
    return this.tipAddresses;
  }
  
  /**
   * Send a bundle of messages to the SOVA service
   * @param messages Array of encoded messages
   * @param expirationMs Expiration time in milliseconds
   * @returns Promise that resolves with the bundle ID
   */
  async sendBundle(messages: Buffer[], expirationMs: number = 60000): Promise<string> {
    try {
      const searcher = this.getSearcher();
      if (!searcher) {
        throw new Error("Could not get searcher for sending bundle");
      }
      
      // Check if the sendBundle method is available
      if (typeof searcher.sendBundle !== 'function') {
        throw new Error("sendBundle method not available on searcher");
      }
      
      if (!this.isAuthenticated()) {
        throw new Error("Client not authenticated, cannot send bundle");
      }
      
      if (messages.length === 0) {
        throw new Error("Cannot send empty bundle");
      }
      
      // Create expiration timestamp
      const expirationDate = new Date(Date.now() + expirationMs);
      
      // Format messages for the bundle
      const formattedMessages = messages.map(data => ({ data }));
      
      // Create the bundle
      const bundle = {
        message: formattedMessages,
        expiration_ns: {
          seconds: Math.floor(expirationDate.getTime() / 1000),
          nanos: (expirationDate.getTime() % 1000) * 1000000
        }
      };
      
      // Send the bundle
      const response = await searcher.sendBundle(bundle);
      const bundleId = response.id;
      
      logger.info({ bundleId, messageCount: messages.length }, "Bundle sent successfully");
      this.emit('bundleSent', { bundleId, messageCount: messages.length });
      
      return bundleId;
    } catch (error) {
      logger.error({ error }, "Failed to send bundle");
      this.emit('bundleSendError', error);
      throw error;
    }
  }
}

/**
 * Initialize and authenticate a SOVA client for the TON testnet
 * @returns Wrapped SovaClient instance with enhanced functionality
 */
export function initializeClient(): SovaClientWrapper {
  try {
    // Get endpoint and TLS settings from environment variables
    const endpoint = process.env.SOVA_ENDPOINT || 'testnet-engine.sova.network:30020';
    const useTls = process.env.SOVA_TLS !== 'false';
    
    logger.info({ endpoint, useTls }, "Initializing SOVA client with custom endpoint");
    
    // Add gRPC verbose logging for debugging
    if (process.env.DEBUG_GRPC === 'true') {
      process.env.GRPC_VERBOSITY = 'DEBUG';
      process.env.GRPC_TRACE = 'all';
      logger.info("Enabled verbose gRPC logging");
    }
    
    // Define client options with improved connection settings
    const clientOptions = {
      'grpc.keepalive_timeout_ms': 10000,
      'grpc.keepalive_time_ms': 20000,
      'grpc.max_reconnect_backoff_ms': 10000,
      'grpc.initial_reconnect_backoff_ms': 1000,
      'grpc.http2.min_time_between_pings_ms': 10000,
      'grpc.http2.max_pings_without_data': 0,
      'grpc.keepalive_permit_without_calls': 1,
      'grpc.enable_retries': 1,
      'grpc.service_config': JSON.stringify({
        methodConfig: [{
          name: [{ service: 'searcher.Searcher' }],
          retryPolicy: {
            maxAttempts: 5,
            initialBackoff: '1s',
            maxBackoff: '10s',
            backoffMultiplier: 1.5,
            retryableStatusCodes: ['UNAVAILABLE', 'UNKNOWN']
          }
        }]
      })
    };
    
    // Get testnet client with custom endpoint and options
    let client: any;
    
    try {
      // Try with custom endpoint if supported
      // @ts-ignore - Ignore if the method signature doesn't match
      client = getTestnetClient(endpoint, { useTls, channelOptions: clientOptions });
      logger.info("Successfully created client with custom endpoint and options");
    } catch (error) {
      logger.warn({ error }, "Failed to create client with custom endpoint, falling back to default");
      client = getTestnetClient();
      logger.info("Created client with default settings");
    }
    
    // Read the private key from file
    const privateKey = readPrivateKey();
    logger.info({ keyLength: privateKey.length }, "Private key extracted");
    
    // Log the first few bytes of the key for debugging (never do this in production)
    if (privateKey.length > 0) {
      logger.info({ 
        keyPreview: `${privateKey.slice(0, 4).toString('hex')}...${privateKey.slice(-4).toString('hex')}` 
      }, "Key preview (first and last 4 bytes)");
    }
    
    // Authenticate with the client (non-blocking)
    if (privateKey.length === 32) {
      client.authenticate(privateKey)
        .then(() => {
          logger.info("SOVA client authenticated successfully");
        })
        .catch((err: Error) => {
          logger.warn({ err: err.message }, "SOVA client authentication failed, continuing with limited access");
          logger.info("Mempool subscription should still work without authentication");
          
          // Try to diagnose connection issues
          if (err.message.includes('ECONNREFUSED')) {
            logger.error("Connection refused. Please check if the endpoint is correct and accessible from your network");
            logger.info("You can try setting SOVA_TLS=false or using a different endpoint via SOVA_ENDPOINT");
          } else if (err.message.includes('CERT_HAS_EXPIRED')) {
            logger.error("Certificate has expired. Please check your system time or contact SOVA support");
          } else if (err.message.includes('UNAVAILABLE')) {
            logger.error("Service unavailable. Please check if the SOVA service is running and accessible");
          }
        });
    } else {
      logger.warn({ keyLength: privateKey.length }, "Invalid private key length, skipping authentication");
      logger.info("Mempool subscription should still work without authentication");
    }
    
    return client;
  } catch (error) {
    logger.error({ error }, "Failed to initialize SOVA client");
    
      // Return a basic client anyway so the application can continue
    logger.info("Returning basic client despite initialization error");
    return new SovaClientWrapper(getTestnetClient());
  }
  
  // Create the enhanced client wrapper with the initialized client
  // This line is unreachable but kept for clarity
  return new SovaClientWrapper(getTestnetClient());
}
