import re

with open('AurumAI_Executor.mq5', 'r') as f:
    content = f.read()

# Replace variables
content = re.sub(r'input double InpMicroTPMin\s*=\s*8\.0;\s*// Base Micro TP \(pips: 8\.0 = \$0\.80 Gold\)', r'input double InpMicroTPMin         = 15.0;  // Base Micro TP (pips: 15.0 = $1.50 Gold)', content)
content = re.sub(r'input double InpMicroTPStep\s*=\s*1\.0;\s*// TP Step per layer \(pips\)', r'input double InpMicroTPStep        = 3.0;   // TP Step per layer (pips)', content)
content = re.sub(r'input double InpMinLot\s*=\s*0\.02;\s*// Lot per layer for Conf < 75%', r'input double InpMinLot             = 0.01;  // Lot per layer for Conf < 75%', content)
content = re.sub(r'input double InpMidLot\s*=\s*0\.03;\s*// Lot per layer for Conf 75-84%', r'input double InpMidLot             = 0.02;  // Lot per layer for Conf 75-84%', content)
content = re.sub(r'input double InpMaxLot\s*=\s*0\.05;\s*// Lot per layer for Conf >= 85%', r'input double InpMaxLot             = 0.03;  // Lot per layer for Conf >= 85%', content)

# Check if Daily Loss Limit exists, if not append after InpMaxPositions
if 'InpDailyLossLimitIDR' not in content:
    content = re.sub(r'(input int\s+InpMaxPositions\s*=\s*25;\s*// Max simultaneous open positions)', 
                    r'\1\ninput double InpDailyLossLimitIDR  = 500000.0; // Daily Loss Limit (IDR/Cent) to stop EA if drawdown is too large', 
                    content)

with open('AurumAI_Executor.mq5', 'w') as f:
    f.write(content)

print("Patched successfully")
