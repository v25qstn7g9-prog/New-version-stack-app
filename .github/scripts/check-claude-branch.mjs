import { pathToFileURL } from 'node:url';

// A necessary launch condition, not proof that every App bypass is disabled.
export async function checkClaudeBranchSafety(repository, branch, token, request = fetch) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '') || !branch || !token)
    throw new Error('無法確認主線保護：缺少 repository、分支或 GitHub 授權');
  let data;
  try {
    const response = await request('https://api.github.com/repos/' + repository + '/branches/' + encodeURIComponent(branch), {
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error();
    data = await response.json();
  } catch { throw new Error('無法確認主線保護，已停止啟動 Claude；請檢查 GitHub 權限與連線'); }
  if (data?.protected !== true)
    throw new Error('主線未啟用分支保護，已停止啟動 Claude。請先確認適用於 Claude App 的保護規則，或改用沒有主線寫入能力的 AI worker');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await checkClaudeBranchSafety(process.env.GITHUB_REPOSITORY, process.env.BASE_BRANCH, process.env.GH_TOKEN);
    console.log('GitHub 回報主線已受保護；仍須另行確認 App 繞過權限與實際規則。');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
