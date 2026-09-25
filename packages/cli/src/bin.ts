#!/usr/bin/env node

/**
 * Thin wrapper: the only place that reads `process` and calls `process.exit`. All behaviour lives
 * in `main`, which is a pure-ish function over its context so the CLI can be tested in-process.
 */

import { commandFromArgv } from './command-from-argv.js';
import { EXIT_CODES } from './exit-codes.js';
import { loadDotenv } from './load-dotenv.js';
import { main } from './main.js';

loadDotenv({ cwd: process.cwd(), env: process.env });

const argv = process.argv.slice(2);
const stopping = new AbortController();

/**
 * Only `watch` takes over the interrupt, and only once.
 *
 * A handler installed for every command would swallow the first Ctrl-C of a one-shot run, which
 * must keep dying instantly. `once` leaves the default behaviour in place for a second interrupt,
 * so an impatient user can still kill a watch session mid-sample.
 */
if (commandFromArgv(argv).command === 'watch') {
  process.once('SIGINT', () => stopping.abort());
  process.once('SIGTERM', () => stopping.abort());
}

main({
  argv,
  env: process.env,
  streams: {
    writeOut: (text) => process.stdout.write(text),
    writeError: (text) => process.stderr.write(text),
  },
  now: () => new Date(),
  stopSignal: stopping.signal,
})
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = EXIT_CODES.unexpectedError;
  });
