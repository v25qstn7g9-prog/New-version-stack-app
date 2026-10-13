import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// 因子回測的樣本來自 trendRadarHistory。法人／融資／日KD 是背景慢慢載入的，
// 第一筆快照常常比它們先寫，必須在載入完成後補進同一筆，否則樣本永遠是 0／空。
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const hist = html.slice(html.indexOf('const instNow=instDays.length>0;'), html.indexOf('records=records.slice(-1500);'));

test('slow prior-day fields are filled into an existing snapshot once they load', () => {
  assert.ok(hist.includes('const fillSlow=(rec,r)=>{'));
  assert.ok(hist.includes('if(!rec||rec.actual||rec.day!==day) return;'), 'never touches a snapshot that already has its outcome, or another day');
  assert.ok(hist.includes('if(instNow&&rec.instLoaded!==true){'));
  assert.ok(hist.includes('if(!rec.margin&&r.margin) rec.margin=marginForRecord(r.margin);'));
  assert.ok(hist.includes('if(rec.kd?.kDaily==null&&r.kdDaily){'));
});

test('both the morning and the close-lock snapshots call it, and mark whether institutional data was loaded', () => {
  assert.equal((hist.match(/fillSlow\(records\.find\(x=>x\.key===key\),r\)/g) || []).length, 2);
  assert.equal((hist.match(/instLoaded:instNow,inst:\{f1:r\.f1,/g) || []).length, 2);
});

test('the probability and intraday fields are never rewritten by the fill', () => {
  const fill = hist.slice(hist.indexOf('const fillSlow='), hist.indexOf('// Keep a representative morning forecast'));
  for (const field of ['probability', 'rawProbability', 'volumePrice', 'breadth', 'direction', 'ts']) {
    assert.ok(!new RegExp(`rec\\.${field}\\s*=`).test(fill), `fillSlow must not assign rec.${field}`);
  }
});
