// Creates server/.env with a local SQLite URL when missing (secrets are generated on first start).
import { existsSync, readFileSync, appendFileSync } from 'node:fs';
const file = new URL('../.env', import.meta.url);
const content = existsSync(file) ? readFileSync(file, 'utf8') : '';
if (!/^DATABASE_URL=/m.test(content)) appendFileSync(file, `${content && !content.endsWith('\n') ? '\n' : ''}DATABASE_URL=file:./dev.db\n`);
