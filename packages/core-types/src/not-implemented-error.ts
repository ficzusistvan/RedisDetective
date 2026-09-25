export type NotImplementedContextValue = string | number | boolean | null;

export interface NotImplementedContext {
  readonly [key: string]: NotImplementedContextValue;
}

/**
 * Thrown by scaffolded functions that have a settled signature but no implementation.
 *
 * Scaffolding throws rather than returning an empty result on purpose: a silent empty
 * `EvidenceGraph` looks like "your Redis is fine", which is the single most damaging wrong
 * answer this tool could give.
 */
export class NotImplementedError extends Error {
  readonly feature: string;

  readonly context: NotImplementedContext;

  constructor(feature: string, context: NotImplementedContext = {}) {
    super(`Redis Detective: "${feature}" is scaffolded but not implemented yet.`);
    this.name = 'NotImplementedError';
    this.feature = feature;
    this.context = context;
  }
}
