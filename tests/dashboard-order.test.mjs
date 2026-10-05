import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// 總覽頁順序依使用習慣：總資產 → 即時股價 → 今日趨勢雷達 → 新聞 → 收盤報告 → 資產曲線（歷史）→ 進階績效。
test('dashboard sections follow usage order: today first, history after', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const start = html.indexOf('function Dashboard({ totalToday');
  const body = html.slice(start, html.indexOf('\n}\n', start));
  const order = [
    'premium-asset-hero',
    '<LivePricePanel',
    'title="今日趨勢雷達"',
    '<NewsCarousel',
    '<DailyClosingAiReport',
    '<UiLabel zh="資產曲線" />',
    'title="進階績效分析"',
  ].map((marker) => {
    const at = body.indexOf(marker);
    assert.ok(at >= 0, `missing ${marker}`);
    return at;
  });
  for (let i = 1; i < order.length; i++) assert.ok(order[i] > order[i - 1], `section ${i} is out of order`);
});

test('the asset hero no longer contains the history chart', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const dash = html.indexOf('function Dashboard({ totalToday');
  const start = html.indexOf('premium-asset-hero', dash);
  const hero = html.slice(start, html.indexOf('<LivePricePanel', start));
  assert.doesNotMatch(hero, /資產曲線|資產高點|AreaChart/);
});
