const { MarketDataService, CandleBuilder } = require('./build/services/marketDataService');

async function run() {
  const md = new MarketDataService();
  // Override start to not use config (since it's not compiled)
  
  // Actually, wait, just use the classes
  let lastMinuteFired = new Date().getUTCMinutes();
  console.log('started');
  
  setInterval(() => {
      const now = Date.now();
      const currentMinute = new Date(now).getUTCMinutes();
      if (currentMinute !== lastMinuteFired) {
         lastMinuteFired = currentMinute;
         console.log(`[Timer FIRED] now = ${now} = ${new Date(now).toISOString()}`);
         md.processAllTicks(2400, 0, now, true);
      }
  }, 200);

  md.setOnM5Closed((data) => {
    console.log(`[M5 CLOSED] Current time: ${new Date().toISOString()}. M5 Candle time: ${new Date(data.currentM5.time).toISOString()}`);
  });
  
  md.setOnM1Closed((data) => {
    console.log(`[M1 CLOSED] Current time: ${new Date().toISOString()}. M1 Candle time: ${new Date(data.currentM1.time).toISOString()}`);
  });
  
  // inject a tick to start the candle
  md.processAllTicks(2400, 10, Date.now() - 30000);
}

run();
