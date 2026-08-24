import re

with open('backend/src/services/signalGenerator.ts', 'r') as f:
    content = f.read()

# 1. Relax RR from 1.3 to 1.0
content = re.sub(r'if \(trueRR < 1\.3\) \{', r'if (trueRR < 1.0) {', content)
content = re.sub(r'\(True RR \$\{trueRR\.toFixed\(1\)\}x < 1\.3x\)', r'(True RR ${trueRR.toFixed(1)}x < 1.0x)', content)
content = re.sub(r'if \(trueRR >= 1\.3 && trueRR < 1\.6\) \{', r'if (trueRR >= 1.0 && trueRR < 1.5) {', content)

# 2. Relax structure trigger to include strong H1/M15 trend alignment as a trigger
old_trigger = r"const hasStructureTrigger = analysis.marketStructureM15.includes\('BOS'\) \|\| analysis.marketStructureM15.includes\('CHOCH'\) \|\| analysis.marketStructureM15.includes\('FAKE_BREAKOUT'\) \|\| isNewsBreakout;"
new_trigger = "const hasStructureTrigger = analysis.marketStructureM15.includes('BOS') || analysis.marketStructureM15.includes('CHOCH') || analysis.marketStructureM15.includes('FAKE_BREAKOUT') || isNewsBreakout || (analysis.trendH1 !== 'NEUTRAL' && analysis.trendH1 === analysis.trendM15) || analysis.fibonacciZoneM15 !== 'NONE';"
content = content.replace(old_trigger, new_trigger)

with open('backend/src/services/signalGenerator.ts', 'w') as f:
    f.write(content)

print("Patched signalGenerator successfully")
