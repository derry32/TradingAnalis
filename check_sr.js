const fs = require("fs");
const raw = JSON.parse(fs.readFileSync("/app/data/market_history.json"));

// Aggregate to H1
let h1 = [];
let cur = null;
for (const c of raw) {
  const ps = Math.floor(c.time / (3600000)) * 3600000;
  if (!cur) { cur = { time: ps, open: c.open, high: c.high, low: c.low, close: c.close }; }
  else if (cur.time === ps) { cur.high = Math.max(cur.high, c.high); cur.low = Math.min(cur.low, c.low); cur.close = c.close; }
  else { h1.push(cur); cur = { time: ps, open: c.open, high: c.high, low: c.low, close: c.close }; }
}
h1.push(cur);

// Find swing points (simplified: local highs/lows over 3 candles)
const swings = [];
for (let i = 3; i < h1.length - 3; i++) {
  const isHigh = h1[i].high >= Math.max(...h1.slice(i-3,i).map(c=>c.high)) && h1[i].high >= Math.max(...h1.slice(i+1,i+4).map(c=>c.high));
  const isLow = h1[i].low <= Math.min(...h1.slice(i-3,i).map(c=>c.low)) && h1[i].low <= Math.min(...h1.slice(i+1,i+4).map(c=>c.low));
  if (isHigh) swings.push({ type: 'HIGH', price: h1[i].high, time: h1[i].time });
  if (isLow)  swings.push({ type: 'LOW', price: h1[i].low, time: h1[i].time });
}

// Calculate M15 ATR
let m15 = [];
let c15 = null;
for (const c of raw) {
  const ps = Math.floor(c.time / (900000)) * 900000;
  if (!c15) { c15 = { time: ps, open: c.open, high: c.high, low: c.low, close: c.close }; }
  else if (c15.time === ps) { c15.high = Math.max(c15.high, c.high); c15.low = Math.min(c15.low, c.low); c15.close = c.close; }
  else { m15.push(c15); c15 = { time: ps, open: c.open, high: c.high, low: c.low, close: c.close }; }
}
m15.push(c15);
const recent15 = m15.slice(-15);
let atrSum = 0;
for (let i = 1; i < recent15.length; i++) {
  const tr = Math.max(recent15[i].high - recent15[i].low, Math.abs(recent15[i].high - recent15[i-1].close), Math.abs(recent15[i].low - recent15[i-1].close));
  atrSum += tr;
}
const atr = atrSum / 14;
const threshold = Math.max(atr * 1.5, 5);

const currentH1 = h1[h1.length - 1];
const currentPrice = raw[raw.length - 1].close;
const recentLows = swings.filter(s => s.type === 'LOW').slice(-3);
const recentHighs = swings.filter(s => s.type === 'HIGH').slice(-3);

console.log("=== DIAGNOSTIK S/R ===");
console.log(`Current Price (M5 close): ${currentPrice}`);
console.log(`Current H1 Close: ${currentH1.close}`);
console.log(`ATR M15: ${atr.toFixed(2)}, Threshold: ${threshold.toFixed(2)}`);
console.log(`Recent Swing LOWs (H1):`, recentLows.map(s => s.price.toFixed(2)));
console.log(`Recent Swing HIGHs (H1):`, recentHighs.map(s => s.price.toFixed(2)));
console.log(`Total swings found: ${swings.length}`);

for (const low of recentLows) {
  const dist = Math.abs(currentH1.close - low.price);
  console.log(`  LOW ${low.price.toFixed(2)}: distance = ${dist.toFixed(2)} (threshold: ${threshold.toFixed(2)}) → ${dist <= threshold ? '✅ AT SUPPORT' : '❌ too far'}`);
}
for (const high of recentHighs) {
  const dist = Math.abs(high.price - currentH1.close);
  console.log(`  HIGH ${high.price.toFixed(2)}: distance = ${dist.toFixed(2)} (threshold: ${threshold.toFixed(2)}) → ${dist <= threshold ? '✅ AT RESISTANCE' : '❌ too far'}`);
}
