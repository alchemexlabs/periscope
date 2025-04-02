#!/usr/bin/env node

/**
 * Enhanced script to test SOVA connectivity with various configurations
 * Run with: node verify-sova-connection.js
 * 
 * Environment variables:
 * - SOVA_ENDPOINT: Custom endpoint (default: testnet-engine.sova.network:30020)
 * - SOVA_TLS: Set to 'false' to disable TLS
 * - SOVA_KEY_PATH: Path to private key file
 * - DEBUG_GRPC: Set to 'true' for verbose gRPC logging
 */

const { getTestnetClient } = require('@sova-labs/sdk');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Set up basic logging
function log(level, message, data = {}) {
  console.log(JSON.stringify({
    level,
    message,
    timestamp: new Date().toISOString(),
    ...data
  }, null, 2));
}

/**
 * Reads and processes the private key from the file system
 * Supports multiple key file formats
 */
function readPrivateKey() {
  try {
    // Try multiple possible key file paths
    const possibleKeyPaths = [
      path.resolve(__dirname, '../private_key.pem'),
      path.resolve(__dirname, '../sova-pubkey.key'),
      path.resolve(__dirname, 'private_key.pem')
    ];
    
    // Use environment variable if provided
    const envKeyPath = process.env.SOVA_KEY_PATH;
    if (envKeyPath) {
      possibleKeyPaths.unshift(path.resolve(envKeyPath));
    }
    
    // Find the first key file that exists
    let keyPath = '';
    let keyFileExists = false;
    
    for (const filePath of possibleKeyPaths) {
      if (fs.existsSync(filePath)) {
        keyPath = filePath;
        keyFileExists = true;
        break;
      }
    }
    
    if (!keyFileExists) {
      log('warn', "No private key file found in any of the expected locations");
      return Buffer.from([]);
    }
    
    log('info', `Reading private key from ${keyPath}`);
    const fileContent = fs.readFileSync(keyPath);
    
    // Check if this is a PEM file or raw key file
    const contentStr = fileContent.toString('utf8').trim();
    
    if (contentStr.includes('-----BEGIN') && contentStr.includes('PRIVATE KEY-----')) {
      // This is a PEM file
      log('info', "PEM file detected, extracting ED25519 key");
      return extractPrivateKeyFromPEM(fileContent);
    } else if (fileContent.length === 32) {
      // This might be a raw 32-byte key file
      log('info', "Raw 32-byte key file detected");
      return fileContent;
    } else if (contentStr.length === 64 && /^[0-9a-fA-F]+$/.test(contentStr)) {
      // This might be a hex-encoded 32-byte key
      log('info', "Hex-encoded key file detected");
      return Buffer.from(contentStr, 'hex');
    } else {
      // Try to extract key from other formats
      log('warn', "Unknown key format, attempting to use as raw key");
      return fileContent.length === 32 ? fileContent : Buffer.from([]);
    }
  } catch (error) {
    log('error', "Error reading private key", { error: error.message });
    return Buffer.from([]);
  }
}

/**
 * Extracts the raw ED25519 private key from a PEM file
 */
function extractPrivateKeyFromPEM(pemContent) {
  try {
    // Convert buffer to string and remove headers, footers, and newlines
    const pemString = pemContent.toString('utf8');
    const base64Content = pemString
      .replace('-----BEGIN PRIVATE KEY-----', '')
      .replace('-----END PRIVATE KEY-----', '')
      .replace('-----BEGIN ENCRYPTED PRIVATE KEY-----', '')
      .replace('-----END ENCRYPTED PRIVATE KEY-----', '')
      .replace(/\s/g, '');
    
    // Decode base64 to get the ASN.1 DER encoded key
    const derBuffer = Buffer.from(base64Content, 'base64');
    
    // For ED25519 keys, search for the pattern and extract the key
    let keyStart = -1;
    for (let i = 0; i < derBuffer.length - 5; i++) {
      if (
        derBuffer[i] === 0x06 && 
        derBuffer[i + 1] === 0x03 && 
        derBuffer[i + 2] === 0x2B && 
        derBuffer[i + 3] === 0x65 && 
        derBuffer[i + 4] === 0x70
      ) {
        // Found the OID for ED25519, the key should be 32 bytes and start a few bytes later
        for (let j = i + 5; j < derBuffer.length - 2; j++) {
          if (derBuffer[j] === 0x04 && derBuffer[j + 1] === 0x20) {
            keyStart = j + 2;
            break;
          }
        }
        break;
      }
    }
    
    if (keyStart >= 0 && keyStart + 32 <= derBuffer.length) {
      log('info', `Found private key at offset ${keyStart} in DER structure`);
      return derBuffer.slice(keyStart, keyStart + 32);
    } else {
      // If we can't find the key using the OID method, try a simpler approach
      // This is a fallback that might work in some cases
      if (derBuffer.length >= 48) { // ED25519 keys are typically found after some ASN.1 headers
        log('warn', 'Could not find key at expected location, using last 32 bytes as fallback');
        return derBuffer.slice(derBuffer.length - 32); // Try taking the last 32 bytes
      }
      log('warn', 'Could not find ED25519 key in PEM file');
      return Buffer.from([]);
    }
  } catch (error) {
    log('error', 'Error extracting private key', { error: error.message });
    return Buffer.from([]);
  }
}

/**
 * Test connectivity with multiple configurations
 */
async function testConnectivity() {
  log('info', '=== SOVA Connectivity Test ===');
  
  // Enable verbose gRPC logging if requested
  if (process.env.DEBUG_GRPC === 'true') {
    process.env.GRPC_VERBOSITY = 'DEBUG';
    process.env.GRPC_TRACE = 'all';
    log('info', 'Enabled verbose gRPC logging');
  }
  
  // Get configuration from environment or use defaults
  const endpoint = process.env.SOVA_ENDPOINT || 'testnet-engine.sova.network:30020';
  const useTls = process.env.SOVA_TLS !== 'false';
  log('info', `Using SOVA endpoint: ${endpoint} with TLS: ${useTls}`);
  
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
  
  // Try different client initialization approaches
  let client;
  
  try {
    log('info', 'Attempting to create client with custom options');
    // Try with custom endpoint if supported by the SDK version
    try {
      // @ts-ignore - Ignore if the method signature doesn't match
      client = getTestnetClient(endpoint, { useTls, channelOptions: clientOptions });
      log('info', 'Successfully created client with custom endpoint and options');
    } catch (error) {
      log('warn', 'Failed to create client with custom endpoint, falling back to default', { error: error.message });
      client = getTestnetClient();
      log('info', 'Created client with default settings');
    }
    
    // Read the private key
    const privateKey = readPrivateKey();
    
    if (privateKey.length > 0) {
      log('info', 'Private key extracted', { 
        keyLength: privateKey.length,
        keyPreview: `${privateKey.slice(0, 4).toString('hex')}...${privateKey.slice(-4).toString('hex')}`
      });
      
      // Try authentication
      if (privateKey.length === 32) {
        log('info', 'Attempting authentication with private key');
        try {
          await client.authenticate(privateKey);
          log('info', 'Authentication successful!');
        } catch (authError) {
          log('error', 'Authentication failed', { error: authError.message });
          
          if (authError.message.includes('ECONNREFUSED')) {
            log('error', 'Connection refused. Please check if the endpoint is correct and accessible from your network');
            log('info', 'Suggestions:');
            log('info', '1. Try setting SOVA_TLS=false to disable TLS');
            log('info', '2. Check if the endpoint is reachable using: nc -zv testnet-engine.sova.network 30020');
            log('info', '3. Try a different endpoint via SOVA_ENDPOINT environment variable');
          }
        }
      } else {
        log('warn', 'Invalid private key length, skipping authentication', { keyLength: privateKey.length });
      }
    } else {
      log('warn', 'No valid private key found, skipping authentication');
    }
    
    // Try to get a searcher instance
    log('info', 'Getting searcher from client');
    const searcher = client.getSearcher();
    
    if (!searcher) {
      log('error', 'Failed to get searcher from client');
      return;
    }
    
    // Try to subscribe to mempool
    log('info', 'Attempting to subscribe to mempool for workchain 0');
    const stream = searcher.subscribeByWorkchain(0);
    
    // Set up event handlers
    let dataReceived = false;
    
    stream.on('data', (data) => {
      dataReceived = true;
      log('info', 'Received mempool data!', { 
        dataPreview: JSON.stringify(data).substring(0, 100) + '...',
        timestamp: new Date().toISOString()
      });
    });
    
    stream.on('error', (error) => {
      log('error', 'Mempool subscription error', { error: error.message, code: error.code });
    });
    
    stream.on('end', () => {
      log('warn', 'Mempool subscription ended');
    });
    
    stream.on('status', (status) => {
      log('info', 'Mempool subscription status', { status });
    });
    
    // Wait for data or timeout
    log('info', 'Waiting for 30 seconds to receive data...');
    setTimeout(() => {
      if (!dataReceived) {
        log('warn', 'No data received within timeout period');
        log('info', 'This could be normal if there are no transactions in the mempool');
      }
      
      log('info', 'Test completed');
      process.exit(0);
    }, 30000);
    
  } catch (error) {
    log('error', 'Error testing connectivity', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

// Run the test
testConnectivity();
