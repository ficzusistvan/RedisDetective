export class RedisConnectionError extends Error {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = 'RedisConnectionError';
  }
}
