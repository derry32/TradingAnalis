import axios from 'axios';
import { config } from 'dotenv';
config();

async function checkTwelveData() {
  const apiKey = process.env.TWELVEDATA_API_KEY;
  if (!apiKey) {
    console.log("No TWELVEDATA_API_KEY in .env");
    return;
  }
  
  try {
    const res = await axios.get(`https://api.twelvedata.com/price?symbol=XAU/USD&apikey=${apiKey}`);
    console.log("TwelveData Price Response:", res.data);
    
    const tsRes = await axios.get(`https://api.twelvedata.com/time_series?symbol=XAU/USD&interval=1min&outputsize=5&apikey=${apiKey}`);
    console.log("TwelveData TimeSeries Status:", tsRes.data.status);
    if (tsRes.data.status === 'error') {
       console.log("Error details:", tsRes.data.message);
    } else {
       console.log("Latest candle time:", tsRes.data.values[0].datetime);
    }
  } catch(e: any) {
    console.error("Failed to connect:", e.message);
  }
}

checkTwelveData();
