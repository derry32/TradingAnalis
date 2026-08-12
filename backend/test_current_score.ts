import { marketDataService } from './src/services/marketDataService';
import { featureEngine } from './src/services/featureEngine';
import { confidenceEngine } from './src/services/confidenceEngine';

async function run() {
  await marketDataService.initialize();
  const data = marketDataService.getLatestData();
  if (data.m1.length < 10) {
    console.log("No data");
    return;
  }
  const currentPrice = data.currentM1?.close || data.m5[data.m5.length - 1].close;
  const snapshot = featureEngine.generateSnapshot(data.m1, data.m5, data.m15, data.h1, currentPrice);
  const evalNew = confidenceEngine.evaluate(snapshot);
  console.log("Direction:", evalNew.direction, "Score:", evalNew.totalScore);
  console.log("Reasons:", evalNew.reasons);
  console.log("Warnings:", evalNew.warnings);
  process.exit(0);
}
run();
