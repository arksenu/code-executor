import fs from 'node:fs';

export function loadSeccompProfile(path: string) {
  return JSON.parse(fs.readFileSync(path, 'utf8')) as Record<string, unknown>;
}
