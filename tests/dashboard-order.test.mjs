import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// 總覽頁：同主題放一起，主題內先今天再歷史。
// 我的資產（總資產＋高點回撤 → 即時股價 → 資產曲線）→ 市場分析（趨勢雷達、新聞、收盤報告）→ 進階績效。
const html = fs.readFileSync('index.html', 'utf8');
const dashStart = html.indexOf('function Dashboard({ totalToday');
const body = html.slice(dashStart, html.indexOf('\n}\n', dashStart));

test('dashboard sections are grouped by subject: my assets, then market analysis, then advanced', () => {
  const order = [
    'premium-asset-hero',
    '<UiLabel zh="資產高點" />',
    '<LivePricePanel',
    '<UiLabel zh="資產曲線" />',
    'title="今日趨勢雷達"',
    '<NewsCarousel',
    '<DailyClosingAiReport',
    'title="進階績效分析"',
  ].map((marker) => {
    const at = body.indexOf(marker);
    assert.ok(at >= 0, `missing ${marker}`);
    return at;
  });
  for (let i = 1; i < order.length; i++) assert.ok(order[i] > order[i - 1], `section ${i} is out of order`);
});

test('high point and drawdown live in the total-assets card; the curve card only holds the chart', () => {
  const heroStart = body.indexOf('premium-asset-hero');
  const hero = body.slice(heroStart, body.indexOf('<LivePricePanel', heroStart));
  assert.match(hero, /資產高點/);
  assert.match(hero, /<UiLabel zh="回撤" \/>/);
  assert.match(hero, /<UiLabel zh="在高點" inline \/>/, 'at a new high we say so instead of +0.00%');
  assert.doesNotMatch(hero, /AreaChart/);
  const curveStart = body.indexOf('<UiLabel zh="資產曲線" />');
  const curve = body.slice(curveStart, body.indexOf('title="今日趨勢雷達"'));
  assert.match(curve, /AreaChart/);
  assert.doesNotMatch(curve, /資產高點|目前回撤/);
});

test('new labels have English translations', () => {
  for (const zh of ['回撤', '在高點']) assert.match(html, new RegExp(`"${zh}": "`));
});
