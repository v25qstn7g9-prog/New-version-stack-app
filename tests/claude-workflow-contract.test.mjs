import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const install = 'cp ci/package-lock.json package-lock.json && npm ci --no-audit --no-fund';

function lowerBound(range) {
  const match = /^>=(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(String(range).trim());
  assert.ok(match, 'unsupported engines range: ' + range);
  return [Number(match[1]), Number(match[2] || 0), Number(match[3] || 0)];
}

function majorSatisfies(major, range) {
  const minimum = lowerBound(range);
  const got = [major, 0, 0];
  for (let i = 0; i < 3; i += 1) {
    if (got[i] > minimum[i]) return true;
    if (got[i] < minimum[i]) return false;
  }
  return true;
}

function nodeMajors(section) {
  return [...section.matchAll(/^ *node-version: (\d+)\s*$/gm)].map(match => Number(match[1]));
}

test('Claude workflow keeps owner-only draft handoff and does not widen permissions', async () => {
  const workflow = await readFile(new URL('../.github/workflows/claude.yml', import.meta.url), 'utf8');
  const [implement, publishing] = workflow.split('\n  open-pr:\n');
  assert.ok(publishing, 'open-pr stays a separate job');
  assert.match(workflow, /contents: read\n/);
  assert.doesNotMatch(workflow, /pull_request_target/);
  assert.match(implement, /github\.event\.sender\.login == github\.repository_owner/);
  assert.match(implement, /github\.event\.issue\.user\.login == github\.repository_owner/);
  assert.match(implement, /contains\(github\.event\.issue\.body, '@claude'\)/);
  assert.match(implement, /contains\(github\.event\.issue\.title, '@claude'\)/);
  assert.match(implement, /contains\(github\.event\.comment\.body, '@claude'\)/);
  assert.match(implement, /persist-credentials: true/);
  assert.match(implement, /additional_permissions: \|\n\s+actions: read/);
  assert.match(implement, /anthropics\/claude-code-action@c0949c50a78c1ec8ce2647db36629b870e715d0c # v1/);
  assert.match(implement, /claude_code_oauth_token: \$\{\{ secrets\.CLAUDE_CODE_OAUTH_TOKEN \}\}/);
  assert.match(implement, /anthropic_api_key: \$\{\{ secrets\.CLAUDE_CODE_OAUTH_TOKEN == '' && secrets\.ANTHROPIC_API_KEY \|\| '' \}\}/);
  assert.match(publishing, /permissions:\n\s+contents: read\n\s+id-token: write/);
  assert.doesNotMatch(publishing, /contents: write/);
  assert.doesNotMatch(publishing, /ANTHROPIC_API_KEY|CLAUDE_CODE_OAUTH_TOKEN|npm ci/);
  assert.match(publishing, /persist-credentials: false/);
  assert.match(publishing, /ref: \$\{\{ github\.sha \}\}/);
});

test('Claude workflow shows full output, installs this repo lockfile, and never asks to merge', async () => {
  const workflow = await readFile(new URL('../.github/workflows/claude.yml', import.meta.url), 'utf8');
  const testWorkflow = await readFile(new URL('../.github/workflows/test.yml', import.meta.url), 'utf8');
  const [implement, publishing] = workflow.split('\n  open-pr:\n');
  assert.match(testWorkflow, new RegExp(install.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(implement, new RegExp(install.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.ok(implement.indexOf(install) < implement.indexOf('anthropics/claude-code-action@'),
    'locked install happens before Claude starts');
  assert.doesNotMatch(publishing, /npm ci|package-lock/);
  assert.match(implement, /show_full_output: 'true'/);
  assert.doesNotMatch(workflow, /show_full_output: 'false'/);
  assert.match(implement, /npm run build:app/);
  assert.match(implement, /npm run build:css/);
  assert.match(implement, /npm run sync:fallback/);
  assert.match(implement, /Run npm test before committing/);
  assert.match(implement, /do not commit it/);
  assert.match(implement, /push main, or turn on auto-merge/);
  assert.match(implement, /do not create or merge it yourself/);
  assert.match(workflow, /draft PR/);
});

test('Claude workflow Node matches test.yml and satisfies this repo engines', async () => {
  const workflow = await readFile(new URL('../.github/workflows/claude.yml', import.meta.url), 'utf8');
  const testWorkflow = await readFile(new URL('../.github/workflows/test.yml', import.meta.url), 'utf8');
  const root = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const fallback = JSON.parse(await readFile(new URL('../fallback-vercel/package.json', import.meta.url), 'utf8'));
  const [implement, publishing] = workflow.split('\n  open-pr:\n');
  const testMajors = nodeMajors(testWorkflow);
  const implementMajors = nodeMajors(implement);
  const publishMajors = nodeMajors(publishing);
  assert.deepEqual(testMajors, [20]);
  assert.deepEqual(implementMajors, [20]);
  assert.deepEqual(publishMajors, [20]);
  for (const major of [...implementMajors, ...publishMajors]) {
    assert.equal(majorSatisfies(major, root.engines.node), true, root.engines.node);
    assert.equal(majorSatisfies(major, fallback.engines.node), true, fallback.engines.node);
  }
});

test('Claude handoff keeps the security boundary and records the repo-specific adaptations', async () => {
  const doc = await readFile(new URL('../docs/claude-handoff.md', import.meta.url), 'utf8');
  assert.match(doc, /草稿 PR/);
  assert.match(doc, /不推 main、不自動合併/);
  assert.match(doc, /Node 20/);
  assert.match(doc, /ci\/package-lock\.json/);
  assert.match(doc, /show_full_output/);
  assert.match(doc, /沒開時 workflow 會拒絕啟動 Claude/);
  assert.match(doc, /CLAUDE_CODE_OAUTH_TOKEN/);
  assert.match(doc, /短效 token（contents:read、pull_requests:write）/);
  assert.match(doc, /不使用 `pull_request_target`/);
  assert.match(doc, /npm run sync:fallback/);
});
