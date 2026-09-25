/** Which command the user invoked. `report` is the default when no subcommand is given. */
export type CliCommand = 'report' | 'watch';

export interface ParsedCommand {
  readonly command: CliCommand;
  /** argv with the subcommand removed, so flag parsing never has to skip it. */
  readonly flags: readonly string[];
}

/**
 * Splits an optional leading subcommand off argv.
 *
 * Recognised in first position only. A `watch` that turns up after the flags is a typo worth
 * reporting as an unexpected argument rather than a mode to guess at.
 *
 * Exported because `bin.ts` needs the same answer before `main` parses anything: it installs the
 * interrupt handlers only for `watch`, so Ctrl-C keeps killing a one-shot run immediately.
 */
export function commandFromArgv(argv: readonly string[]): ParsedCommand {
  if (argv[0] === 'watch') {
    return { command: 'watch', flags: argv.slice(1) };
  }
  return { command: 'report', flags: argv };
}
