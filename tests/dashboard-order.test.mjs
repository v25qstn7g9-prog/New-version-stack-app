import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// 總覽採付費理財 App 的順序：
// ①總資產＋今日損益＋累積報酬＋走勢圖（含台股/美股、高點回撤）
// ②大盤＋持股行情（依市值排序、含佔比）③今日分析（雷達、快訊、收盤報告）④目標進度與進階績效。
const html = fs.readFileSync('index.html', 'utf8');
const dashStart = html.indexOf('function Dashboard({ totalToday');
const body = html.slice(dashStart, html.indexOf('\n}\n', dashStart));

test('dashboard follows the paid finance app order', () => {
  const order = [
    'premium-asset-hero',
    '<UiLabel zh="累積報酬" inline />',
    '<UiLabel zh="資產曲線" />',
    '<UiLabel zh="資產高點" />',
    '<LivePricePanel',
    'title="今日趨勢雷達"',
    '<NewsCarousel',
    '<DailyClosingAiReport',
    '<GoalProgressCard',
    'title="進階績效分析"',
  ].map((marker) => {
    const at = body.indexOf(marker);
    assert.ok(at >= 0, `missing ${marker}`);
    return at;
  });
  for (let i = 1; i < order.length; i++) assert.ok(order[i] > order[i - 1], `section ${i} is out of order`);
});

test('the asset curve lives inside the total-assets card, with high point and drawdown', () => {
  const heroStart = body.indexOf('premium-asset-hero');
  const hero = body.slice(heroStart, body.indexOf('<LivePricePanel', heroStart));
  assert.match(hero, /AreaChart/);
  assert.match(hero, /<UiLabel zh="回撤" \/>/);
  assert.match(hero, /<UiLabel zh="在高點" inline \/>/, 'at a new high we say so instead of +0.00%');
  assert.equal((body.match(/AreaChart data=/g) || []).length, 1, 'only one asset chart on the page');
});

test('goal progress moved from the shared header into a dashboard card', () => {
  const hStart = html.indexOf('function Header({');
  const header = html.slice(hStart, html.indexOf('\n}\n', hStart));
  assert.doesNotMatch(header, /已達成|距目標/);
  const gStart = html.indexOf('function GoalProgressCard(');
  assert.ok(gStart > 0);
  const card = html.slice(gStart, html.indexOf('\n}\n', gStart));
  assert.match(card, /已達成/);
  assert.match(card, /距目標/);
  assert.match(card, /預計 \$\{goalDate\} 達成/);
});

test('live quotes: market index first, holdings sorted by value with weight', () => {
  const pStart = html.indexOf('function LivePricePanel(');
  const panel = html.slice(pStart, html.indexOf('\nfunction ', pStart + 10));
  const live = panel.indexOf('{hasLive && (');
  assert.ok(panel.indexOf('{hasMarketIndex && (', live) < panel.indexOf('<UiLabel zh="佔比" />', live), 'index strip sits above the holdings list');
  assert.match(panel, /\[\.\.\.rows\]\.sort\(\(x, y\) => y\.value - x\.value\)\.map/);
  assert.match(panel, /Math\.round\(\(r\.value \/ totalValue\) \* 100\)/);
});

test('new labels have English translations', () => {
  for (const zh of ['回撤', '在高點', '目標進度', '累積報酬', '佔比']) assert.match(html, new RegExp(`"${zh}": "`));
});
