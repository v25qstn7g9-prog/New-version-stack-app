import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureClaudePr } from '../.github/scripts/ensure-claude-pr.mjs';
import { readFile } from 'node:fs/promises';

const input = {
  repository: 'owner/repo', branch: 'claude/issue-42', base: 'main', issue: '42',
  oidcUrl: 'https://runner.example/oidc?existing=1', oidcRequestToken: 'runner-secret'
};
function transport({ existing = false, createFailure = false, ahead = 1, missing = false } = {}) {
  const calls = [];
  return { calls, request: async (url, options = {}) => {
    const u = new URL(url); calls.push({ url: u, ...options });
    if (u.host === 'runner.example') return Response.json({ value: 'oidc-secret' });
    if (u.host === 'api.anthropic.com') return Response.json({ token: 'app-secret' });
    if (options.method === 'DELETE') return new Response(null, { status: 204 });
    if (u.pathname.includes('/compare/')) return missing
      ? Response.json({ message: 'Not Found' }, { status: 404 })
      : Response.json({ ahead_by: ahead });
    if (options.method === 'POST') return createFailure
      ? Response.json({ message: 'not allowed' }, { status: 403 })
      : Response.json({ html_url: 'https://github.com/owner/repo/pull/7' }, { status: 201 });
    return Response.json(existing ? [{ html_url: 'https://github.com/owner/repo/pull/6',
      head: { ref: input.branch, repo: { full_name: input.repository } }, base: { ref: input.base } }] : []);
  } };
}
test('Claude PR handoff mints its own token, creates a draft, and revokes the token', async () => {
  const t = transport();
  assert.equal(await ensureClaudePr(input, t.request), 'https://github.com/owner/repo/pull/7');
  assert.equal(t.calls[0].url.searchParams.get('audience'), 'claude-code-github-action');
  assert.equal(t.calls[1].headers.Authorization, 'Bearer oidc-secret');
  assert.deepEqual(JSON.parse(t.calls[1].body), {
    permissions: { contents: 'read', pull_requests: 'write' }
  }, 'PR-only token explicitly requests minimum repository permissions');
  const create = t.calls.find(x => x.method === 'POST' && x.url.host === 'api.github.com');
  assert.equal(create.headers.Authorization, 'Bearer app-secret');
  assert.deepEqual(JSON.parse(create.body), {
    title: 'Claude：Issue #42 實作', head: input.branch, base: 'main', draft: true,
    body: 'Closes #42\n\nClaude 依任務 Issue 實作。詳細修改與已執行檢查見 Issue 執行紀錄；請確認 test 與交付區成品一致後再合併。'
  });
  assert.equal(t.calls.at(-1).method, 'DELETE');
  assert.equal(t.calls.at(-1).url.pathname, '/installation/token');
});

test('Claude PR publication runs in a fresh job using the triggering commit, without the subscription secret', async () => {
  const workflow = await readFile(new URL('../.github/workflows/claude.yml', import.meta.url), 'utf8');
  const publishing = workflow.split('\n  open-pr:\n')[1];
  assert.ok(publishing, 'publish in a distinct GitHub Actions job, not the agent process');
  assert.match(publishing, /needs: implement/);
  assert.match(publishing, /runs-on: ubuntu-24\.04/);
  assert.match(publishing, /ref: \$\{\{ github\.sha \}\}/);
  assert.doesNotMatch(publishing, /CLAUDE_CODE_OAUTH_TOKEN|RUNNER_TEMP|download-artifact/);
  assert.match(publishing, /node \.github\/scripts\/ensure-claude-pr\.mjs/);
});
test('Claude PR handoff reuses an existing PR without creating duplicates', async () => {
  const t = transport({ existing: true });
  assert.equal(await ensureClaudePr(input, t.request), 'https://github.com/owner/repo/pull/6');
  assert.equal(t.calls.filter(x => x.method === 'POST' && x.url.host === 'api.github.com').length, 0);
  assert.equal(t.calls.at(-1).method, 'DELETE');
});
test('Claude PR handoff revokes on PR failure and never includes token values in its error', async () => {
  const t = transport({ createFailure: true });
  await assert.rejects(ensureClaudePr(input, t.request), error => {
    assert.match(error.message, /403/);
    assert.doesNotMatch(error.message, /app-secret|oidc-secret|runner-secret/);
    return true;
  });
  assert.equal(t.calls.at(-1).method, 'DELETE');
});
test('Claude PR handoff rejects main or malformed issue before requesting credentials', async () => {
  for (const bad of [{ branch: 'main' }, { issue: '42;command' }, { oidcRequestToken: '' }]) {
    const t = transport();
    await assert.rejects(ensureClaudePr({ ...input, ...bad }, t.request));
    assert.equal(t.calls.length, 0);
  }
});
test('Claude implementation accepts a subscription token or an API key, and keeps both out of the PR job', async () => {
  const workflow = await readFile(new URL('../.github/workflows/claude.yml', import.meta.url), 'utf8');
  const [implement, publishing] = workflow.split('\n  open-pr:\n');
  assert.match(implement, /CLAUDE_API_KEY: \$\{\{ secrets\.ANTHROPIC_API_KEY \}\}/);
  assert.match(implement, /if \[ -z "\$CLAUDE_OAUTH" \] && \[ -z "\$CLAUDE_API_KEY" \]/);
  assert.match(implement, /claude_code_oauth_token: \$\{\{ secrets\.CLAUDE_CODE_OAUTH_TOKEN \}\}/);
  assert.match(implement, /anthropic_api_key: \$\{\{ secrets\.CLAUDE_CODE_OAUTH_TOKEN == '' && secrets\.ANTHROPIC_API_KEY \|\| '' \}\}/,
    'API key is only passed when no subscription token is set');
  assert.match(implement, /Require protected main before launching Claude/, 'branch-protection guard stays');
  assert.doesNotMatch(publishing, /ANTHROPIC_API_KEY/);
});
test('Claude implement job keeps checkout credentials for the action\'s base fetch; the PR job does not', async () => {
  const workflow = await readFile(new URL('../.github/workflows/claude.yml', import.meta.url), 'utf8');
  const [implement, publishing] = workflow.split('\n  open-pr:\n');
  assert.match(implement, /persist-credentials: true/);
  assert.doesNotMatch(implement, /persist-credentials: false/);
  assert.match(publishing, /persist-credentials: false/);
});
test('Claude PR handoff skips the PR when Claude pushed nothing, and still revokes the token', async () => {
  for (const opts of [{ ahead: 0 }, { missing: true }]) {
    const t = transport(opts);
    assert.equal(await ensureClaudePr(input, t.request), null);
    const compare = t.calls.find(x => x.url.pathname.includes('/compare/'));
    assert.equal(compare.url.pathname, '/repos/owner/repo/compare/main...claude%2Fissue-42');
    assert.equal(t.calls.filter(x => x.method === 'POST' && x.url.host === 'api.github.com').length, 0);
    assert.equal(t.calls.at(-1).method, 'DELETE');
  }
});
