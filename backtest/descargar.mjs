import { writeFile } from 'node:fs/promises';
for (const [sym, iv] of [['BTCUSDT','1d'],['ETHUSDT','1d'],['SOLUSDT','1d'],['ETHBTC','1d'],['SOLBTC','1d']]) {
  let start = 0, all = [];
  while (true) {
    const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=${iv}&startTime=${start}&limit=1000`).then(r=>r.json());
    if (!r.length) break;
    all.push(...r.map(k=>({t:k[0],o:+k[1],h:+k[2],l:+k[3],c:+k[4],v:+k[5],ct:k[6]})));
    start = r.at(-1)[0] + 1;
    if (r.length < 1000) break;
  }
  all = all.filter(k=>k.ct < Date.now());
  await writeFile(new URL(`./${sym}_${iv}.json`, import.meta.url), JSON.stringify(all));
  console.log(sym, all.length, new Date(all[0].t).toISOString().slice(0,10), new Date(all.at(-1).t).toISOString().slice(0,10));
}
