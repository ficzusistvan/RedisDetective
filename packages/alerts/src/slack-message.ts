export interface SlackTextObject {
  readonly type: 'plain_text' | 'mrkdwn';
  readonly text: string;
  readonly emoji?: boolean;
}

export interface SlackBlock {
  readonly type: string;
  readonly text?: SlackTextObject;
  readonly fields?: readonly SlackTextObject[];
  readonly elements?: readonly SlackTextObject[];
}

/**
 * Incoming-webhook body. `text` is the notification fallback; `blocks` is Block Kit.
 */
export interface SlackIncomingWebhookBody {
  readonly text: string;
  readonly blocks: readonly SlackBlock[];
}
