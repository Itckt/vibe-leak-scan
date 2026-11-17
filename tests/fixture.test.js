import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createFixture } from '../fixtures/site.js';
import { fixtureKeys } from '../fixtures/keys.js';
import { detectSecrets, SECRET_TYPES } from '../src/secrets.js';
import { allowPrivate } from './helpers.js';

test('fixture builds fake keys at runtime; no complete fixture key is a source literal', async () => {
  const source = (await Promise.all(['keys.js', 'site.js', 'server.js'].map((name) => readFile(new URL(`../fixtures/${name}`, import.meta.url), 'utf8')))).join('\n');
  for (const key of Object.values(fixtureKeys())) {
    assert.ok(!source.includes(key), 'No full fixture key may appear in source code');
    assert.ok(!source.includes(JSON.stringify(key).slice(1, -1)), 'No escaped full fixture key may appear in source code');
  }
});

test('local fixture serves all expected fake leak shapes over HTTP', async (t) => {
  allowPrivate(t);
  const fixture = await createFixture();
  t.after(fixture.close);
  const home = await fetch(fixture.origin);
  assert.equal(home.status, 200);
  const scripts = await Promise.all(['app.js', 'chunk.js', 'nested.js'].map(async (name) => (await fetch(`${fixture.origin}/assets/${name}`)).text()));
  const types = new Set(detectSecrets(scripts.join('\n')).map((item) => item.type));
  for (const type of Object.keys(SECRET_TYPES)) assert.ok(types.has(type), `Missing fixture shape: ${type}`);
  const map = await (await fetch(`${fixture.origin}/assets/app.js.map`)).json();
  assert.equal(map.version, 3);
});
