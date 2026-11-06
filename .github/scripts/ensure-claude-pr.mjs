// Claude's composite action revokes its App token before it returns. Obtain a
// separate short-lived token through the same official OIDC exchange, use it
// only for PR creation, and revoke it in this process. No credentials on disk.
import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export async function ensureClaudePr(input, request = fetch) {
  const { repository, branch, base, issue, oidcUrl, oidcRequestToken } = input;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '') || !/^claude\/[\w./-]+$/.test(branch || '') ||
      !base || branch === base || !/^[1-9]\d*$/.test(issue || '') || !oidcRequestToken)
    throw new Error('Invalid repository, Claude branch, issue or OIDC configuration');
  const oidc = new URL(oidcUrl);
  if (oidc.protocol !== 'https:') throw new Error('OIDC endpoint must use HTTPS');
  oidc.searchParams.set('audience', 'claude-code-github-action');
  async function call(url, options, label) {
    let response;
    try { response = await request(url, { ...options, signal: AbortSignal.timeout(15000) }); }
    catch { throw new Error(label + ': network request failed'); }
    if (!response.ok) throw new Error(label + ': HTTP ' + response.status);
    return response;
  }
  async function json(response, label) {
    try { return await response.json(); }
    catch { throw new Error(label + ': invalid JSON response'); }
  }
  const { value: identity } = await json(await call(oidc, {
    headers: { Authorization: 'Bearer ' + oidcRequestToken }
  }, 'GitHub OIDC'), 'GitHub OIDC');
  if (!identity) throw new Error('GitHub OIDC did not return an identity');
  const exchanged = await json(await call('https://api.anthropic.com/api/github/github-app-token-exchange', {
    method: 'POST', headers: { Authorization: 'Bearer ' + identity, 'Content-Type': 'application/json' },
    body: JSON.stringify({ permissions: { contents: 'read', pull_requests: 'write' } })
  }, 'Claude App token exchange'), 'Claude App token exchange');
  const token = exchanged.token || exchanged.app_token;
  if (!token) throw new Error('Claude App token exchange did not return a token');
  const headers = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' };
  const root = 'https://api.github.com';
  try {
    const list = new URL(root + '/repos/' + repository + '/pulls');
    list.searchParams.set('state', 'open');
    list.searchParams.set('head', repository.split('/')[0] + ':' + branch);
    list.searchParams.set('base', base);
    list.searchParams.set('per_page', '100');
    const prs = await json(await call(list, { headers }, 'List Claude PRs'), 'List Claude PRs');
    const existing = prs.find(pr => pr.head?.repo?.full_name === repository && pr.head.ref === branch && pr.base?.ref === base);
    if (existing) return existing.html_url;
    // A question-only @claude run pushes nothing: no branch, or a branch with
    // no commits ahead of base. GitHub refuses such a PR (422), so skip it.
    const compareUrl = root + '/repos/' + repository + '/compare/' +
      encodeURIComponent(base) + '...' + encodeURIComponent(branch);
    let compared;
    try { compared = await request(compareUrl, { headers, signal: AbortSignal.timeout(15000) }); }
    catch { throw new Error('Compare Claude branch: network request failed'); }
    if (compared.status === 404) return null;
    if (!compared.ok) throw new Error('Compare Claude branch: HTTP ' + compared.status);
    const { ahead_by: ahead } = await json(compared, 'Compare Claude branch');
    if (!(ahead > 0)) return null;
    const created = await json(await call(root + '/repos/' + repository + '/pulls', {
      method: 'POST', headers, body: JSON.stringify({
        title: 'Claude：Issue #' + issue + ' 實作', head: branch, base, draft: true,
        body: 'Closes #' + issue + '\n\nClaude 依任務 Issue 實作。詳細修改與已執行檢查見 Issue 執行紀錄；請確認 test 與交付區成品一致後再合併。'
      })
    }, 'Create Claude draft PR'), 'Create Claude draft PR');
    if (!created.html_url) throw new Error('Create Claude draft PR returned no URL');
    return created.html_url;
  } finally {
    await call(root + '/installation/token', { method: 'DELETE', headers }, 'Revoke PR App token');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const url = await ensureClaudePr({
      repository: process.env.GITHUB_REPOSITORY, branch: process.env.CLAUDE_BRANCH,
      base: process.env.BASE_BRANCH, issue: process.env.ISSUE_NUMBER,
      oidcUrl: process.env.ACTIONS_ID_TOKEN_REQUEST_URL,
      oidcRequestToken: process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
    });
    const summary = url
      ? 'Claude 已提交分支；請查看草稿 PR 與其 test 結果：' + url + '\n'
      : 'Claude 這次沒有提交程式碼變更（例如只回答問題），不建立草稿 PR。\n';
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
    console.log(summary.trim());
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
