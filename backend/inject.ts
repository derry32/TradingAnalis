import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!.replace('/rest/v1/', ''),
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkMultiple() {
  const { data: signals } = await supabase.from('signals').select('*').limit(1000).order('timestamp', { ascending: false });
  if (!signals) return;
  
  for (const sig of signals) {
    try {
      const reasonObj = typeof sig.reason === 'string' ? JSON.parse(sig.reason) : sig.reason;
      if (reasonObj.id === 'AURUM-840002') {
        console.log(`FOUND ROW: ${sig.id}`);
        console.log(reasonObj);
      }
    } catch(e) {}
  }
}
checkMultiple();
