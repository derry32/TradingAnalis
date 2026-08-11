import { MarketDataService } from './src/services/marketDataService';
import { config } from './src/config';

async function run() {
  const md = new MarketDataService();
  
  md.setOnM1Closed((data) => {
    console.log(`[EVENT] M1 Closed. Current time: ${new Date().toISOString()}. Candle time: ${new Date(data.currentM1!.time).toISOString()}`);
  });

  md.setOnM5Closed((data) => {
    console.log(`[EVENT] M5 Closed. Current time: ${new Date().toISOString()}. Candle time: ${new Date(data.currentM5.time).toISOString()}`);
  });

  md.setOnTickUpdate((price, ts) => {
    // console.log(`Tick: ${price} at ${new Date(ts).toISOString()}`);
  });

  console.log('Starting MarketDataService test...');
  await md.start();
}

run();
