const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: './.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function run() {
  const { data, error } = await supabase
    .from('signals')
    .select('id, timestamp, type, reason')
    .gte('timestamp', '2026-07-16T17:00:00Z') // July 17 WIB
    .lt('timestamp', '2026-07-17T17:00:00Z');
    
  if (error) {
    console.error(error);
  } else {
    console.log(`Total signals on 2026-07-17: ${data.length}`);
    const types = data.reduce((acc, curr) => {
        acc[curr.type] = (acc[curr.type] || 0) + 1;
        return acc;
    }, {});
    console.log(`Types:`, types);
  }
}
run();
