#!/usr/bin/env node
import { runCli } from './cli/shell/main.ts';
import { GateSelectionError } from './project/index.ts';

try {
  process.exitCode = await runCli(process.argv.slice(2));
} catch (error) {
  if (!(error instanceof GateSelectionError)) throw error;
  console.error(error.message);
  process.exitCode = 2;
}
