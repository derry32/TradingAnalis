import re

with open('backend/src/services/signalGenerator.ts', 'r') as f:
    content = f.read()

# Replace calculateScoreV2 implementation
old_score_func = r"private calculateScoreV2\(analysis: AnalysisResult, sentimentScore: number, currentPrice: number, activeStrategy: string\): \{ score: number; reasons: string\[\]; warnings: string\[\] \} \{"
new_score_func = """private calculateScoreV2(analysis: AnalysisResult, sentimentScore: number, currentPrice: number, activeStrategy: string): { score: number; reasons: string[]; warnings: string[]; entryQuality: number } {
    let setupScore = 0;
    const reasons: string[] = [];
    const warnings: string[] = [];
    let entryQuality = 50; // Base quality

    // 1. Regime & Bias (H1 & M15) - Max 60 pts
    if (analysis.trendH1 !== 'NEUTRAL') {
      setupScore += 20;
      reasons.push(`Tren makro (H1) stabil di fase ${analysis.trendH1}.`);
      if (analysis.trendH1 === analysis.trendM15) {
        setupScore += 20;
        reasons.push(`Struktur mikro (M15) selaras dengan tren H1.`);
      }
    }
    
    if (analysis.marketStructureM15.includes('BOS') || analysis.marketStructureM15.includes('CHOCH')) {
      setupScore += 20;
      reasons.push(`Konfirmasi breakout struktur M15: ${analysis.marketStructureM15}`);
    }

    // 2. Setup & Impulse (M5) - Max 40 pts
    if (analysis.patternM5 !== 'NONE') {
      setupScore += 15;
      reasons.push(`Setup lilin M5: ${analysis.patternM5}`);
    }
    if (analysis.strongVolumeM5) {
      setupScore += 15;
      reasons.push(`Momentum volume kuat di M5.`);
    }
    if (analysis.fvgM5.type !== 'NONE') {
      setupScore += 10;
      reasons.push(`Zona Imbalance (FVG) terdeteksi di M5.`);
    }

    // 3. Entry Quality Engine (M1) - Max 100 pts
    if (analysis.isExtendedM5) {
       entryQuality -= 30; // Penalty for chasing extended M5 candles
       warnings.push('M5 over-extended (FOMO Alert).');
    }

    if (analysis.m1LiquiditySweep) {
       entryQuality += 20;
       reasons.push('M1 Liquidity Sweep terdeteksi.');
       if (analysis.m1Bos) {
          entryQuality += 20;
          reasons.push('Konfirmasi M1 Reclaim & BOS.');
       }
    }

    if (analysis.m1Ob !== 'NONE') {
       entryQuality += 20;
       reasons.push(`M1 Order Block (${analysis.m1Ob}) tervalidasi dengan displacement.`);
    }

    // Cap scores
    setupScore = Math.min(100, Math.max(0, setupScore));
    entryQuality = Math.min(100, Math.max(0, entryQuality));

    return { score: setupScore, reasons, warnings, entryQuality };
}
"""

# Extract the body of old calculateScoreV2 and replace it
# Since old calculateScoreV2 is long, I will use regex to find the whole method body
content = re.sub(r'private calculateScoreV2\(analysis: AnalysisResult, sentimentScore: number, currentPrice: number, activeStrategy: string\): \{ score: number; reasons: string\[\]; warnings: string\[\] \} \{.*?return \{ score: finalScore, reasons, warnings \};\n  \}', new_score_func, content, flags=re.DOTALL)


# Update generate() to use Entry Quality and Noise Budget
generate_old = r"""    const scoreResult = this.calculateScoreV2\(analysis, sentimentScore, currentPrice, activeStrategy\);
    const minScore = activeStrategy === 'HYPER_SCALPER' \? \(isNewsMode \? 50 : 55\) : \(isNewsMode \? 60 : 65\);

    if \(scoreResult\.score < minScore\) \{
      return this\.createWaitSignal\(`Skor probabilitas tidak memenuhi syarat \(\$\{scoreResult\.score\} < \$\{minScore\}\)\. \$\{scoreResult\.warnings\.join\(' '\)\}`, activeStrategy\);
    \}"""

generate_new = """    const scoreResult = this.calculateScoreV2(analysis, sentimentScore, currentPrice, activeStrategy);
    const minSetupScore = activeStrategy === 'HYPER_SCALPER' ? (isNewsMode ? 50 : 55) : (isNewsMode ? 60 : 65);

    if (scoreResult.score < minSetupScore) {
      return this.createWaitSignal(`Setup Score rendah (${scoreResult.score} < ${minSetupScore}). ${scoreResult.warnings.join(' ')}`, activeStrategy);
    }
    
    // Dynamic Noise Budget (M1 ATR + Spread) vs SL
    // We assume spread is ~3 pips (0.3)
    const expectedNoise = analysis.atr_M1 + 0.3; 
"""

content = re.sub(r"    const scoreResult = this\.calculateScoreV2\(analysis, sentimentScore, currentPrice, activeStrategy\);\n    const minScore = activeStrategy === 'HYPER_SCALPER' \? \(isNewsMode \? 50 : 55\) : \(isNewsMode \? 60 : 65\);\n\n    if \(scoreResult\.score < minScore\) \{\n      return this\.createWaitSignal\(`Skor probabilitas tidak memenuhi syarat \(\$\{scoreResult\.score\} < \$\{minScore\}\)\. \$\{scoreResult\.warnings\.join\(' '\)\}`, activeStrategy\);\n    \}", generate_new, content)

# Check Noise Budget after SL calculation
sl_check_old = r"""if \(riskDist > 5\.5\) \{
        if \(scoreResult\.score >= 85\) \{"""

sl_check_new = """
      const noiseBudget = riskDist * 0.8;
      if (expectedNoise > noiseBudget) {
          return this.createWaitSignal(`Volatilitas/Noise terlalu tinggi (${expectedNoise.toFixed(2)} > SL Budget ${noiseBudget.toFixed(2)}). Bahaya whipsaw.`, activeStrategy);
      }

      if (scoreResult.entryQuality < 60) {
          return this.createWaitSignal(`Setup OK (${scoreResult.score}), tapi Entry Quality buruk (${scoreResult.entryQuality}). Menunggu Pullback/Sweep M1.`, activeStrategy);
      }
      
      if (riskDist > 5.5) {
        if (scoreResult.score >= 85) {"""
content = content.replace(sl_check_old, sl_check_new)


with open('backend/src/services/signalGenerator.ts', 'w') as f:
    f.write(content)

print("Patched SG M1 successfully")
