import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

const supabaseUrlRaw = process.env.SUPABASE_URL || '';
const supabaseUrl = supabaseUrlRaw.replace('/rest/v1/', '');
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase credentials in env.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function analyze() {
  const { data, error } = await supabase
    .from('signals')
    .select('*')
    .order('timestamp', { ascending: false })
    .limit(500);

  if (error || !data) return;

  const buySlTrades = data.filter(r => {
      try {
          const res = JSON.parse(r.reason);
          return res.finalStatus === 'HIT_SL' && r.type === 'BUY';
      } catch(e) { return false; }
  });

  console.log(`Found ${buySlTrades.length} BUY SL trades.`);
  
  if (buySlTrades.length > 0) {
      console.log("Sample reason from a BUY SL trade:");
      console.log(JSON.parse(buySlTrades[0].reason));
      console.log(JSON.parse(buySlTrades[1].reason));
  }
}

analyze();
