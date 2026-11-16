import { readFileSync } from 'node:fs';

/** Read a JSON fixture by file name. Kept out of the *.core tests, which may not touch the filesystem. */
export const fixture = (name: string): string => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
