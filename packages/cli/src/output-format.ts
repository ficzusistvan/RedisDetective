export const CLI_OUTPUT_FORMATS = ['text', 'json', 'markdown'] as const;

export type CliOutputFormat = (typeof CLI_OUTPUT_FORMATS)[number];

export function isCliOutputFormat(value: string): value is CliOutputFormat {
  return (CLI_OUTPUT_FORMATS as readonly string[]).includes(value);
}
