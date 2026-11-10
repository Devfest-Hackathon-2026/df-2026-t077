import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, renameSync, unlinkSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

async function digest(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

/** Only used for the explicitly named runtime cache file under .tools/downloads. */
export async function downloadVerified(url, destination, sha256, fetcher = fetch) {
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('Invalid checksum metadata');
  if (existsSync(destination)) {
    if (await digest(destination) === sha256) return;
    unlinkSync(destination); // A corrupt runtime cache must not poison every future retry.
  }
  const partial = destination + '.part-' + process.pid;
  if (existsSync(partial)) unlinkSync(partial);
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(180_000) });
    if (!response.ok || !response.body) throw new Error('Tool download failed: HTTP ' + response.status);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(partial, { flags: 'wx' }));
    if (await digest(partial) !== sha256) throw new Error('Tool checksum mismatch; download was not installed');
    renameSync(partial, destination);
  } finally {
    if (existsSync(partial)) unlinkSync(partial);
  }
}
