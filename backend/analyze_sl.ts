import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

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

  if (error || !data) {
    console.error("Error fetching signals:", error);
    return;
  }

  let slCount = 0;
  let tpCount = 0;
  let slByStrategy: any = {};
  let slByDirection: any = {};
  let slByCondition: any = {};

  for (const row of data) {
    let reasonObj: any = {};
    try {
      reasonObj = JSON.parse(row.reason);
    } catch (e) {}

    if (reasonObj.finalStatus === 'HIT_SL') {
      slCount++;
      const strategy = reasonObj.strategy || 'UNKNOWN';
      const dir = row.type;
      const cond = reasonObj.condition || 'UNKNOWN';

      slByStrategy[strategy] = (slByStrategy[strategy] || 0) + 1;
      slByDirection[dir] = (slByDirection[dir] || 0) + 1;
      slByCondition[cond] = (slByCondition[cond] || 0) + 1;
    } else if (reasonObj.finalStatus === 'HIT_TP') {
      tpCount++;
    }
  }

  console.log(`--- Analysis of last 500 signals ---`);
  console.log(`Total SL: ${slCount}`);
  console.log(`Total TP: ${tpCount}`);
  console.log(`Win Rate: ${Math.round((tpCount / (tpCount + slCount)) * 100) || 0}%`);
  console.log(`\nSL by Strategy:`, slByStrategy);
  console.log(`SL by Direction:`, slByDirection);
  console.log(`SL by Condition:`, slByCondition);
}

analyze();
