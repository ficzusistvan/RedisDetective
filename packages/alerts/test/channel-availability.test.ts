import { describe, expect, it } from 'vitest';

import { ALERT_CHANNELS, channelAvailability, isChannelEnabled } from '@redis-detective/alerts';

describe('channelAvailability', () => {
  it('leaves every shipping channel available (no paywall)', () => {
    for (const channel of ALERT_CHANNELS) {
      expect(isChannelEnabled(channel)).toBe(true);
      expect(channelAvailability(channel)).toBe('available');
    }
  });
});
