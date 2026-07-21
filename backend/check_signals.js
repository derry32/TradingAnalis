const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL.replace('/rest/v1/', '');
const supabase = createClient(supabaseUrl, process.env.SUPABASE_KEY);

async function run() {
  const { data, error } = await supabase.from('signals').select('*').order('timestamp', { ascending: false }).limit(5);
  if (error) {
    console.error(error);
    return;
  }
  
  for (const row of data) {
    let reasonObj = {};
    try {
      reasonObj = JSON.parse(row.reason);
    } catch(e) {}

    console.log(`ID: ${reasonObj.id}, Entry: ${row.entry_price}, Time: ${row.timestamp}`);
  }
}

run();
