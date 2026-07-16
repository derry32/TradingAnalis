require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL.replace(/\/rest\/v1\/?$/, '');
const supabase = createClient(url, process.env.SUPABASE_KEY);

async function clear() {
  console.log('Clearing dummy signals from Supabase...');
  const { data, error } = await supabase.from('signals').delete().neq('type', 'NOT_EXISTING');
  if (error) console.error(error);
  else console.log('Successfully cleared all signals!');
}

clear();
