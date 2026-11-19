import { parse } from 'smol-toml';
import { readConfig, type ConfigFacts } from '../../src/core/config.ts';

/** The facts in a piece of config text, for core tests: the parser the shell uses, with no shell in sight. */
export const facts = (text: string, kind: 'project' | 'domain' = 'project'): ConfigFacts => readConfig(parse(text), kind);
