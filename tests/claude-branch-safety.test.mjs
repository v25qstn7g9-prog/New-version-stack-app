import assert from 'node:assert/strict';
import test from 'node:test';
import { checkClaudeBranchSafety } from '../.github/scripts/check-claude-branch.mjs';

test('Claude refuses to start when main is unprotected or cannot be verified', async () => {
  for (const reply of [{ protected: false }, {}, { protected: 'true' }]) {
    await assert.rejects(checkClaudeBranchSafety('owner/repo', 'main', 'dummy', async () => Response.json(reply)), /未啟用分支保護/);
  }
  await assert.rejects(checkClaudeBranchSafety('owner/repo', 'main', 'dummy', async () => new Response(null, { status: 403 })), /無法確認/);
  await assert.rejects(checkClaudeBranchSafety('owner/repo', 'main', 'dummy', async () => { throw Error('dummy-private-error'); }), e => {
    assert.match(e.message, /無法確認/); assert.doesNotMatch(e.message, /dummy-private-error/); return true;
  });
});
test('Claude branch check uses the fixed GitHub API and accepts only a verified protected branch', async () => {
  let request;
  await checkClaudeBranchSafety('owner/repo', 'main', 'dummy', async (url, options) => {
    request = { url: String(url), options }; return Response.json({ protected: true });
  });
  assert.equal(request.url, 'https://api.github.com/repos/owner/repo/branches/main');
  assert.equal(request.options.headers.Authorization, 'Bearer dummy');
});
