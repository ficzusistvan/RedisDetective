import type {
  AnomalyKind,
  EvidenceGapKind,
  EvidenceStrength,
  GrowthMechanism,
  TtlDriftKind,
} from '@redis-detective/core-types';

export interface EvidencePhrase {
  /** Short label for a report heading or list item. */
  readonly summary: string;
  /** What the user should go and do, or `null` when there is nothing to act on. */
  readonly action: string | null;
}

export const STRENGTH_LABEL: Record<EvidenceStrength, string> = {
  strong: 'strong evidence',
  moderate: 'moderate evidence',
  unclear: 'unclear evidence',
};

/**
 * How each evidence kind is worded for a human.
 *
 * A lookup table rather than prose assembled at the call site, so that every wording the tool can
 * emit is visible in one place and reviewable as writing. This is presentation only: it adds no
 * facts. The numbers, the pattern names and the windows all come from the `EvidenceGraph`, and
 * nothing here may assert anything the graph does not already establish.
 *
 * Note that these actions are deterministic consequences of a mechanism the evidence identified —
 * "TTLs disappeared, so look at what writes this pattern". They are not diagnoses of their own, and
 * they are the reason the CLI does not need an LLM to be useful.
 */
export const EVIDENCE_VOCABULARY = {
  anomaly: {
    'memory-growth': {
      summary: 'Memory grew steadily',
      action: null,
    },
    'memory-step-change': {
      summary: 'Memory jumped in a single interval',
      action:
        'Check what shipped in this window. A discrete jump usually means a deploy or a config change rather than gradual accumulation.',
    },
    'fragmentation-growth': {
      summary: 'Allocator overhead grew while stored data stayed flat',
      action:
        'This is fragmentation, not new data. Consider activedefrag, or a restart during a maintenance window if the ratio keeps climbing.',
    },
    'key-count-growth': {
      summary: 'Key count grew faster than memory',
      action: null,
    },
    'eviction-onset': {
      summary: 'The instance started evicting keys',
      action:
        'The instance is at its ceiling and is already discarding data. Raise maxmemory or reduce what is stored; the growth below is the reason it got here.',
    },
  } satisfies Record<AnomalyKind, EvidencePhrase>,

  mechanism: {
    'more-keys': {
      summary: 'more keys of about the same size',
      action:
        'Find what creates keys under this pattern and whether anything is meant to remove them.',
    },
    'larger-values': {
      summary: 'the same keys holding more data',
      action:
        'Look for an append-only write path — a list, set or hash that grows per event and is never trimmed.',
    },
    'keys-not-expiring': {
      summary: 'keys stopped expiring',
      action:
        'Find what writes this pattern and compare it against a working version. A SET that lost its EX argument, or an EXPIRE call that is no longer reached, grows memory forever and shows up in no error log.',
    },
    indeterminate: {
      summary: 'growth the sample cannot break down further',
      action:
        'Re-run with a larger --sample-size to separate "more keys" from "bigger values" for this pattern.',
    },
  } satisfies Record<GrowthMechanism, EvidencePhrase>,

  ttlDrift: {
    'ttl-removed': {
      summary: 'TTLs disappeared',
      action:
        'Highest-value finding here. Something stopped setting an expiry on this pattern; nothing will reclaim these keys until it is fixed.',
    },
    'ttl-coverage-declining': {
      summary: 'fewer keys carry a TTL than before',
      action:
        'Some writers still set an expiry and others no longer do. Look for a second write path added to this pattern.',
    },
    'ttl-lengthened': {
      summary: 'keys still expire, but live longer',
      action:
        'A longer TTL raises the steady-state footprint. Confirm the new lifetime was intended.',
    },
    'never-expiring-growth': {
      summary: 'a pattern that never expired is still growing',
      action:
        'These keys have never had a TTL. If they are not meant to be permanent, this is where to add one.',
    },
  } satisfies Record<TtlDriftKind, EvidencePhrase>,

  /** Gaps carry their own detail and remedy from the graph; this only supplies a heading. */
  gap: {
    'insufficient-snapshots': 'Not enough snapshots',
    'sample-too-small': 'Sample too small',
    'snapshot-gap': 'Unobserved interval',
    'unattributed-growth': 'Growth with no established cause',
    'pattern-not-comparable': 'Patterns that could not be compared',
    'no-repository-connected': 'No repository connected',
    'github-unavailable': 'GitHub unavailable',
    'no-growth-detected': 'No growth found',
  } satisfies Record<EvidenceGapKind, string>,
} as const;
