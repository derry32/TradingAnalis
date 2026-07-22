import TelegramBot from 'node-telegram-bot-api';

const bot = new TelegramBot('8725968521:AAGOBImnjSBW3T3YT66DYHA74Q3-SY8irA4');
const chatId = '-1003949398310';

const signal = {
  strategy: 'SCALPER',
  type: 'BUY',
  probabilityLabel: 'Medium',
  id: 'XAU-20260722-2106',
  confidenceScore: 80,
  session: 'New York (Volatile)',
  marketCondition: 'Trending Bullish',
  entryZone: '4116.11 - 4118.11',
  stopLoss: 4115.11,
  takeProfit1: 4124.11,
  takeProfit2: 4127.11,
  validTime: '20 Menit',
  estimatedTpTime: '20-60 Menit',
  reason: '✔ Trend H1 BULLISH\n✔ M5 BOS/CHoCH Valid\n✔ Price Action M5 (BULLISH ENGULFING) Terkonfirmasi\n✔ EMA 20 & 50 Mendukung'
};

const emoji = signal.type === 'BUY' ? '🟢' : '🔴';
const formattedTime = '21:06 WIB';
const formattedReason = signal.reason.split('\n').map(r => r.startsWith('✔') || r.startsWith('✖') || r.startsWith('🚨') ? r : `* ${r}`).join('\n');

const message = `
🚨 [${signal.strategy} MODE] 🚨
${emoji} **${signal.type} - ${signal.probabilityLabel}**
Signal ID: \`${signal.id}\`
Time: ${formattedTime}
Confidence: ${signal.confidenceScore}%

Session: ${signal.session}
Market Condition: ${signal.marketCondition}

**Entry Zone**: ${signal.entryZone}
**SL**: ${signal.stopLoss.toFixed(2)}
**TP1**: ${signal.takeProfit1.toFixed(2)} (RR 1:2)
**TP2**: ${signal.takeProfit2.toFixed(2)} (RR 1:3)

Valid Time: ${signal.validTime}
Est. TP Time: ${signal.estimatedTpTime}

**Reason:**
${formattedReason}
`.trim();

console.log('Sending message to channel...');
bot.sendMessage(chatId, message, { parse_mode: 'Markdown' }).then(() => {
  console.log('Success! Message sent.');
  process.exit(0);
}).catch(e => {
  console.error('Error sending message:', e);
  process.exit(1);
});
