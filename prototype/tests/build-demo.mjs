import { writeFile } from 'node:fs/promises';
import { makeZip, demoEntries } from './fixtures.mjs';
await writeFile(new URL('../web/demo-cdat.zip', import.meta.url), makeZip(demoEntries()));
console.log('Synthetic demo-cdat.zip generated.');
