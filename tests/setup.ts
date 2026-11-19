import { webcrypto } from 'node:crypto';
// jsdom's Crypto does not implement SubtleCrypto; use the actual platform digest.
Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
