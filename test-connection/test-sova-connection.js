#!/usr/bin/env node

/**
 * Simple script to test direct connectivity to the SOVA service
 * Run with: node test-sova-connection.js
 */

// Import required modules
const { getTestnetClient } = require('@sova-labs/sdk');
const fs = require('fs');
const path = require('path');

// Set up basic logging
function log(level, message, data = {}) {
  console.log(JSON.stringify({
    level,
    message,
    timestamp: new Date().toISOString(),
    ...data
  }));
}

// Extract private key from PEM file (simplified version)
function extractPrivateKeyFromPEM(pemContent) {
  try {
    // Convert buffer to string and remove headers, footers, and newlines
    const pemString = pemContent.toString('utf8');
    const base64Content = pemString
      .replace('-----BEGIN PRIVATE KEY-----', '')
      .replace('-----END PRIVATE KEY-----', '')
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
        keyStart = i + 12; // This offset might need adjustment
        break;
      }
    }
    
    if (keyStart >= 0 && keyStart + 32 <= derBuffer.length) {
      return derBuffer.slice(keyStart, keyStart + 32);
    } else {
      // If we can't find the key using the OID method, try a simpler approach
      // This is a fallback that might work in some cases
      if (derBuffer.length >= 48) { // ED25519 keys are typically found after some ASN.1 headers
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

// Read private key from file
function readPrivateKey() {
  try {
    const keyPath = path.resolve(__dirname, 'private_key.pem');
    log('info', `Reading private key from ${keyPath}`);
    
    if (!fs.existsSync(keyPath)) {
      log('error', 'Private key file not found');
      return Buffer.from([]);
    }
    
    const pemContent = fs.readFileSync(keyPath);
    log('info', 'PEM file read successfully, extracting ED25519 key');
    
    const privateKey = extractPrivateKeyFromPEM(pemContent);
    
    if (privateKey.length !== 32) {
      log('warn', `Extracted key is not 32 bytes`, { keyLength: privateKey.length });
    }
    
    return privateKey;
  } catch (error) {
    log('error', 'Error reading private key', { error: error.message });
    return Buffer.from([]);
  }
}

// Test basic connectivity
async function testBasicConnectivity() {
  log('info', 'Testing basic connectivity to SOVA service');
  
  try {
    // Enable verbose gRPC logging
    process.env.GRPC_VERBOSITY = 'DEBUG';
    process.env.GRPC_TRACE = 'all';
    
    // Get the endpoint from environment or use default
    const endpoint = process.env.SOVA_ENDPOINT || 'testnet-engine.sova.network:30020';
    const useTls = process.env.SOVA_TLS !== 'false';
    log('info', `Using SOVA endpoint: ${endpoint} with TLS: ${useTls}`);
    
    // Initialize client
    log('info', 'Initializing SOVA client');
    const client = getTestnetClient();
    
    // Try authentication
    const privateKey = readPrivateKey();
    if (privateKey.length === 32) {
      log('info', 'Attempting authentication with private key');
      try {
        await client.authenticate(privateKey);
        log('info', 'Authentication successful');
      } catch (authError) {
        log('error', 'Authentication failed', { error: authError.message });
      }
    } else {
      log('warn', 'Skipping authentication due to invalid key length', { keyLength: privateKey.length });
    }
    
    // Try to subscribe to mempool using the correct API structure
    log('info', 'Getting searcher from client');
    const searcher = client.getSearcher();
    
    if (!searcher) {
      log('error', 'Failed to get searcher from client');
      return;
    }
    
    log('info', 'Attempting to subscribe to mempool for workchain 0');
    const stream = searcher.subscribeByWorkchain(0);
    
    // Set up event handlers
    stream.on('data', (data) => {
      log('info', 'Received mempool data', { dataPreview: JSON.stringify(data).substring(0, 100) + '...' });
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
    
    // Keep the script running for a while to see if we get any data
    log('info', 'Waiting for 30 seconds to receive data...');
    setTimeout(() => {
      log('info', 'Test completed');
      process.exit(0);
    }, 30000);
  } catch (error) {
    log('error', 'Error testing connectivity', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

// Run the test
testBasicConnectivity();
