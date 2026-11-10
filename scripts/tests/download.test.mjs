import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { downloadVerified } from '../download-tool.mjs';

const payload = 'runtime-test-content';
const checksum = createHash('sha256').update(payload).digest('hex');
test('replaces a corrupt cache, verifies a new download and then reuses it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zurashitabi-download-'));
  const file = join(dir, 'runtime.zip');
  writeFileSync(file, 'partial-corrupt-content');
  let calls = 0;
  await downloadVerified('https://example.invalid/test', file, checksum, async () => { calls++; return new Response(payload); });
  assert.equal(readFileSync(file, 'utf8'), payload);
  await downloadVerified('https://example.invalid/test', file, checksum, async () => { calls++; throw new Error('must not download a valid cache'); });
  assert.equal(calls, 1);
});
test('a failed checksum leaves neither an installable file nor an incomplete download', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zurashitabi-download-'));
  const file = join(dir, 'runtime.zip');
  await assert.rejects(downloadVerified('https://example.invalid/test', file, checksum, async () => new Response('wrong')), /checksum mismatch/);
  assert.equal(existsSync(file), false);
  assert.equal(readdirSync(dir).length, 0);
});
