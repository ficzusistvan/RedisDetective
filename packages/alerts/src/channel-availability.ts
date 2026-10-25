import type { AlertChannel } from './alert-channel.js';

export type ChannelAvailability = 'available' | 'requires-license';

/**
 * Future license check for paid channels (email, Teams, Opsgenie, hosted dashboard).
 *
 * Every channel that ships today is available. Do not add a paywall or a license file
 * reader here — this function exists so a later change has one place to ask.
 */
export function isChannelEnabled(_channel: AlertChannel): boolean {
  return channelAvailability(_channel) === 'available';
}

export function channelAvailability(_channel: AlertChannel): ChannelAvailability {
  return 'available';
}
