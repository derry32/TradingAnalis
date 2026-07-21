const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL.replace('/rest/v1/', '');
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data, error } = await supabase.from('signals').select('*');
  if (error) {
    console.error(error);
    return;
  }

  let count = 0;
  for (const row of data) {
    let reasonObj = {};
    try {
      reasonObj = JSON.parse(row.reason);
    } catch(e) {}

    if (reasonObj.id === 'XAU-20260720-136' || reasonObj.id === 'XAU-20260720-476') {
       reasonObj.finalStatus = 'EXPIRED';
       reasonObj.hitTime = '-';
       reasonObj.duration = 0;
       reasonObj.accuracy = 0;
       reasonObj.pips = 0;

       const { data: updated, error: updErr } = await supabase.from('signals').update({ reason: JSON.stringify(reasonObj) }).eq('id', row.id).select();
       if (updErr) console.error("Error updating:", updErr);
       else console.log(`Fixed stuck trade: ${reasonObj.id}, Return Data:`, updated);
    }
       
  }
  console.log(`Targeted cleanup complete.`);
}

run();
