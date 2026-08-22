const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: './.env' });

const supabaseUrlRaw = process.env.SUPABASE_URL || '';
const supabaseUrl = supabaseUrlRaw.replace('/rest/v1/', '');
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase credentials in env.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data, error } = await supabase
    .from('signals')
    .select('id, timestamp, type, reason')
    .gte('timestamp', '2026-08-16T17:00:00Z') // Aug 17 00:00 WIB (assuming UTC+7)
    .lt('timestamp', '2026-08-21T17:00:00Z'); // Aug 22 00:00 WIB
    
  if (error) {
    console.error("DB Error:", error);
  } else {
    let tpCount = 0;
    let slCount = 0;
    let otherCount = 0;

    data.forEach(row => {
        let reasonObj = {};
        try {
            reasonObj = JSON.parse(row.reason);
        } catch(e) {}
        
        if (reasonObj.finalStatus === 'HIT_TP' || (row.reason && row.reason.includes('HIT_TP'))) {
            tpCount++;
        } else if (reasonObj.finalStatus === 'HIT_SL' || (row.reason && row.reason.includes('HIT_SL'))) {
            slCount++;
        } else {
            otherCount++;
        }
    });

    console.log(`--- Result (Mon 17 Aug - Fri 21 Aug) ---`);
    console.log(`Total Entry: ${data.length}`);
    console.log(`Profit (TP): ${tpCount}`);
    console.log(`SL / Minus: ${slCount}`);
    console.log(`Other (Pending/Running): ${otherCount}`);
    if (tpCount + slCount > 0) {
      console.log(`Win Rate: ${Math.round((tpCount / (tpCount + slCount)) * 100)}% (excluding pending/other)`);
    }
  }
}
run();
