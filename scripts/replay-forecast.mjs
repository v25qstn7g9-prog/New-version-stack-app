// Usage: node scripts/replay-forecast.mjs path/to/daily-history-response.json
// Replays price reference bands only, not the unavailable intraday model.
import fs from 'node:fs';
import '../forecast-core.js';
const path=process.argv[2];
if(!path)throw new Error('Provide a saved /daily-history JSON response');
const input=JSON.parse(fs.readFileSync(path,'utf8'));
for(const [symbol,bars] of Object.entries(input.bars||{})){
 console.log(JSON.stringify({symbol,lastSourceDay:bars.at(-1)?.day,...globalThis.ZinfForecast.replayBands(bars)}));
}
