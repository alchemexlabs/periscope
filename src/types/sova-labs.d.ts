/**
 * Type declarations for @sova-labs/sdk
 * This provides TypeScript type definitions for the SOVA SDK
 */

declare module '@sova-labs/sdk' {
  export interface SovaClient {
    authenticate(privateKey: Buffer): Promise<void>;
    getSearcher(): Searcher;
  }

  export interface Searcher {
    subscribeByWorkchain(workchain: number): import('@grpc/grpc-js').ClientReadableStream<unknown>;
    subscribeByAddresses(addresses: string[]): import('@grpc/grpc-js').ClientReadableStream<unknown>;
  }

  export function getTestnetClient(): SovaClient;
  export function getMainnetClient(): SovaClient;
}
