const fs = require("fs");
const data = JSON.parse(fs.readFileSync("/app/data/market_history.json"));
let m15 = [];
let current = null;
for (const c of data) {
  const periodMs = 15 * 60 * 1000;
  const periodStart = Math.floor(c.time / periodMs) * periodMs;
  if (!current) {
    current = { time: periodStart, open: c.open, high: c.high, low: c.low, close: c.close };
  } else if (current.time === periodStart) {
    current.high = Math.max(current.high, c.high);
    current.low = Math.min(current.low, c.low);
    current.close = c.close;
  } else {
    m15.push(current);
    current = { time: periodStart, open: c.open, high: c.high, low: c.low, close: c.close };
  }
}
m15.push(current);
const recent = m15.slice(-15);
let sum = 0;
for(let i = 1; i < recent.length; i++) {
  const high = recent[i].high;
  const low = recent[i].low;
  const prevClose = recent[i-1].close;
  const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
  sum += tr;
}
console.log("Recent 14 M15 TRs sum:", sum);
console.log("ATR 14:", sum / 14);
