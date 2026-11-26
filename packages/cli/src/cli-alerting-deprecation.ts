/**
 * Operator-facing copy for the 0.7.x deprecation of CLI-hosted alerting.
 *
 * Channels and `test-alert` still work through 0.7.x; removal is planned for 0.8 / 1.0.
 * Hosted alerting lives in redis-detective-web. Sampling, `watch --push`, and the
 * one-shot CI `--fail-on-*` gate are not deprecated.
 */

export const WATCH_CLI_ALERTING_DEPRECATION =
  'Deprecated: Slack/webhook/PagerDuty from `watch` will be removed in 0.8 / 1.0. Use redis-detective-web for hosted alerting. `watch` and `watch --push` remain the way to sample and upload.';

export const TEST_ALERT_DEPRECATION =
  'Deprecated: `test-alert` / `alerts test` will be removed in 0.8 / 1.0. Prefer the redis-detective-web test-alert.';

/** Short banner note when watch has alert rules/channels armed. */
export const WATCH_ALERT_BANNER_DEPRECATION =
  'Deprecated in 0.7.x (removal planned for 0.8 / 1.0); prefer redis-detective-web for hosted alerting.';
