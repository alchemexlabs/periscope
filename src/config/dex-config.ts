/**
 * Configuration for DEX-specific values and identifiers
 */

export interface DexConfig {
  name: string;
  contractAddress: string;
  opCode: string;
  tokenConfigs: {
    [token: string]: {
      address?: string;
      poolId?: string;
      tokenId?: string;
      decimals: number;
      minAmount: number;
      maxAmount: number;
      swapOpCode?: string;
    };
  };
}

export const dexConfigs: Record<string, DexConfig> = {
  'DeDust': {
    name: 'DeDust',
    contractAddress: 'EQBfBWT7X2BHg9tXAxzhz2aKiNTU1tpt5NsiK0uSDW_YAJ67',
    opCode: 'b5ee9c72',
    tokenConfigs: {
      'USDT': {
        address: '0a519f99bb5b6d3d3c5c8d5e5f5a5b5c5d5e5f5a5b5c5d5e5f5a5b5c5d5e5f',
        decimals: 6,
        minAmount: 1,
        maxAmount: 1000000,
        swapOpCode: '01e18801'
      },
      'USDC': {
        address: '0b519f99bb5b6d3d3c5c8d5e5f5a5b5c5d5e5f5a5b5c5d5e5f5a5b5c5d5e5f',
        decimals: 6,
        minAmount: 1,
        maxAmount: 1000000,
        swapOpCode: '01e18801'
      },
      'ETH': {
        address: '0c519f99bb5b6d3d3c5c8d5e5f5a5b5c5d5e5f5a5b5c5d5e5f5a5b5c5d5e5f',
        decimals: 18,
        minAmount: 0.0001,
        maxAmount: 100,
        swapOpCode: '01e18801'
      }
    }
  },
  
  'Ston.fi': {
    name: 'Ston.fi',
    contractAddress: 'fdc7cd1d8d0e710105e2b69bbd747eb3748cc4103bc0dd581e91ba4360929b73',
    opCode: 'b5ee9c72',
    tokenConfigs: {
      'USDT': {
        poolId: '0001',
        decimals: 6,
        minAmount: 1,
        maxAmount: 1000000
      },
      'USDC': {
        poolId: '0002',
        decimals: 6,
        minAmount: 1,
        maxAmount: 1000000
      },
      'ETH': {
        poolId: '0003',
        decimals: 18,
        minAmount: 0.0001,
        maxAmount: 100
      }
    }
  },
  
  'Megaton': {
    name: 'Megaton',
    contractAddress: '0bfe2f05a7ccf04aa326cb3ae08c2bb7d9729ddec7fc04a5f9d01007d9c65f9f',
    opCode: 'b5ee9c72',
    tokenConfigs: {
      'USDT': {
        tokenId: '0101',
        decimals: 6,
        minAmount: 1,
        maxAmount: 1000000
      },
      'USDC': {
        tokenId: '0102',
        decimals: 6,
        minAmount: 1,
        maxAmount: 1000000
      },
      'ETH': {
        tokenId: '0103',
        decimals: 18,
        minAmount: 0.0001,
        maxAmount: 100
      }
    }
  }
};

// Helper functions to get DEX-specific values
export function getDexContractAddress(dexName: string): string | null {
  return dexConfigs[dexName]?.contractAddress || null;
}

export function getDexOpCode(dexName: string): string | null {
  return dexConfigs[dexName]?.opCode || null;
}

export function getTokenAddress(dexName: string, token: string): string | null {
  return dexConfigs[dexName]?.tokenConfigs[token]?.address || null;
}

export function getTokenPoolId(dexName: string, token: string): string | null {
  return dexConfigs[dexName]?.tokenConfigs[token]?.poolId || null;
}

export function getTokenId(dexName: string, token: string): string | null {
  return dexConfigs[dexName]?.tokenConfigs[token]?.tokenId || null;
}

export function getTokenSwapOpCode(dexName: string, token: string): string | null {
  return dexConfigs[dexName]?.tokenConfigs[token]?.swapOpCode || null;
}

export function getTokenDecimals(dexName: string, token: string): number {
  return dexConfigs[dexName]?.tokenConfigs[token]?.decimals || 18;
}

export function getTokenMinAmount(dexName: string, token: string): number {
  return dexConfigs[dexName]?.tokenConfigs[token]?.minAmount || 0;
}

export function getTokenMaxAmount(dexName: string, token: string): number {
  return dexConfigs[dexName]?.tokenConfigs[token]?.maxAmount || Infinity;
}

// Get all supported DEXes
export function getSupportedDexes(): string[] {
  return Object.keys(dexConfigs);
}

// Get all supported tokens for a DEX
export function getSupportedTokens(dexName: string): string[] {
  return Object.keys(dexConfigs[dexName]?.tokenConfigs || {});
}

// Check if a DEX supports a specific token
export function isTokenSupported(dexName: string, token: string): boolean {
  return !!dexConfigs[dexName]?.tokenConfigs[token];
} 