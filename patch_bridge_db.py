import re

# 1. Update index.ts
with open('backend/src/index.ts', 'r') as f:
    content = f.read()

content = re.sub(
    r'const profit = Number\(req\.body\.profit\) \|\| 0;\s*const signalId = req\.body\.signalId;\s*const ticket = Number\(req\.body\.ticket\) \|\| 0;\s*await processSignalLayer\(signalId, ticket, profit\);',
    r'''const profit = Number(req.body.profit) || 0;
    const signalId = req.body.signalId;
    const ticket = Number(req.body.ticket) || 0;
    
    await processSignalLayer(signalId, ticket, profit, {
       mfePips: req.body.mfePips ? Number(req.body.mfePips) : undefined,
       maePips: req.body.maePips ? Number(req.body.maePips) : undefined,
       timeToMfeSec: req.body.timeToMfeSec ? Number(req.body.timeToMfeSec) : undefined,
       timeToMaeSec: req.body.timeToMaeSec ? Number(req.body.timeToMaeSec) : undefined
    });''',
    content
)

with open('backend/src/index.ts', 'w') as f:
    f.write(content)


# 2. Update database.ts
with open('backend/src/services/database.ts', 'r') as f:
    db_content = f.read()

db_old_func = r'export async function processSignalLayer\(signalId: string, ticket: number, profit: number\) \{'
db_new_func = r'''export async function processSignalLayer(signalId: string, ticket: number, profit: number, stats?: { mfePips?: number; maePips?: number; timeToMfeSec?: number; timeToMaeSec?: number }) {'''
db_content = db_content.replace(db_old_func, db_new_func)

# Append stats to reason if provided
update_old = r'''const { data, error } = await supabase
      .from\('signals'\)
      .update\(\{ result, hit_sl, hit_tp, realized_pips \}\)'''
update_new = r'''
    let updatePayload: any = { result, hit_sl, hit_tp, realized_pips };
    
    // Merge stats into reason JSON
    if (stats && (stats.mfePips !== undefined || stats.maePips !== undefined)) {
       try {
          const row = await supabase.from('signals').select('reason').eq('id', signalId).single();
          let reasonJson = {};
          if (row.data && row.data.reason) {
             try { reasonJson = JSON.parse(row.data.reason); } catch(e) {}
          }
          if (!reasonJson.performance) reasonJson.performance = {};
          if (stats.mfePips !== undefined) reasonJson.performance.mfePips = stats.mfePips;
          if (stats.maePips !== undefined) reasonJson.performance.maePips = stats.maePips;
          if (stats.timeToMfeSec !== undefined) reasonJson.performance.timeToMfeSec = stats.timeToMfeSec;
          if (stats.timeToMaeSec !== undefined) reasonJson.performance.timeToMaeSec = stats.timeToMaeSec;
          
          updatePayload.reason = JSON.stringify(reasonJson);
       } catch (e) {
          console.error('[DB] Failed to update reason JSON with MFE/MAE stats:', e);
       }
    }

    const { data, error } = await supabase
      .from('signals')
      .update(updatePayload)'''

db_content = re.sub(r'const \{ data, error \} = await supabase\s*\.from\(\'signals\'\)\s*\.update\(\{ result, hit_sl, hit_tp, realized_pips \}\)', update_new, db_content)

with open('backend/src/services/database.ts', 'w') as f:
    f.write(db_content)

print("Patched index and DB successfully")
