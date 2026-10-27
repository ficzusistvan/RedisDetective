import type { AlertEvent } from './alert-event.js';
import { describeAlertFinding, describeAlertFindingKind } from './describe-alert-finding.js';
import type { SlackIncomingWebhookBody, SlackTextObject } from './slack-message.js';

export function buildSlackMessage(event: AlertEvent): SlackIncomingWebhookBody {
  const kind = describeAlertFindingKind(event.finding);
  const verb = event.action === 'resolved' ? 'resolved' : 'firing';
  const headline =
    event.action === 'resolved' ? 'Redis memory alert resolved' : 'Redis memory alert';
  const text = `Redis Detective: ${event.finding.pattern} ${kind} ${verb} on ${event.context.host}`;

  const fields: SlackTextObject[] = [
    field('Pattern', `\`${event.finding.pattern}\``),
    field('What changed', kind),
    field('Detail', describeAlertFinding(event.finding)),
    field('Severity', event.rule.severity),
  ];

  if (event.finding.kind === 'pattern-growth') {
    fields.push(
      field(
        'Growth',
        event.finding.percentGrowth === null
          ? `${String(event.finding.bytesGrowth)} bytes`
          : `${String(event.finding.bytesGrowth)} bytes / ${event.finding.percentGrowth.toFixed(1)}%`,
      ),
    );
  }

  if (event.finding.kind === 'ttl-coverage-drop' || event.finding.kind === 'new-untimed-pattern') {
    const before =
      event.finding.kind === 'ttl-coverage-drop'
        ? `${(event.finding.ttlCoverageBefore * 100).toFixed(1)}%`
        : 'n/a (new pattern)';
    const after = `${(event.finding.ttlCoverageAfter * 100).toFixed(1)}%`;
    fields.push(field('TTL coverage', `${before} → ${after}`));
  }

  if (event.context.likelyCause !== null) {
    fields.push(
      field(
        'Likely cause (Redis-side)',
        `${event.context.likelyCause.pattern}: ${event.context.likelyCause.description}`,
      ),
    );
  }

  if (event.context.commitHints.length > 0) {
    const hints = event.context.commitHints
      .slice(0, 5)
      .map((hint) => `\`${hint.shortSha}\` ${hint.message}`)
      .join('\n');
    fields.push(field('Commit hints (not causes)', hints));
  }

  return {
    text,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: headline, emoji: false },
      },
      { type: 'section', fields },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Host: \`${event.context.host}\` · rule \`${event.rule.id}\` · ${event.action} · figures are estimates`,
          },
        ],
      },
    ],
  };
}

function field(label: string, value: string): SlackTextObject {
  return { type: 'mrkdwn', text: `*${label}*\n${value}` };
}
