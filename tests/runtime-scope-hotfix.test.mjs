import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync('index.html','utf8');

const slice = (name) => {
  const a = html.indexOf(`function ${name}(`);
  assert.ok(a >= 0, `${name} exists`);
  const b = html.indexOf('\nfunction ', a + 20);
  return html.slice(a, b > a ? b : html.length);
};

test('child components never reference AssetTracker-only usAssetLive alias', () => {
  for (const name of ['Dashboard','HoldingsWorkspace']) {
    assert.doesNotMatch(slice(name), /usAssetLive/, `${name} must use its usLive prop`);
  }
});

test('AssetTracker still passes calibrated US asset layer into asset-facing children', () => {
  const tracker = slice('AssetTracker');
  assert.match(tracker, /usLive=\{usAssetLive\}/);
  assert.match(tracker, /usAssetLive\.totalNtd != null/);
});
