import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config';
import { Signal } from './signalGenerator';

export class TelegramService {
  private bot: TelegramBot | null = null;

  constructor() {
    if (config.TELEGRAM_BOT_TOKEN) {
      this.bot = new TelegramBot(config.TELEGRAM_BOT_TOKEN, { polling: true });
      console.log('[Telegram] Bot started.');
      
      this.bot.onText(/\/start/, (msg) => {
        const chatId = msg.chat.id;
        this.bot?.sendMessage(chatId, `Selamat datang di AI Trading XAU/USD!\nChat ID Anda: ${chatId}`);
      });
    } else {
      console.warn('[Telegram] No Bot Token. Telegram notifications disabled.');
    }
  }

  public async sendSignal(signal: Signal) {
    if (!this.bot || !config.TELEGRAM_CHAT_ID) {
      console.log('[Telegram Mock Signal]', signal);
      return;
    }

    const emoji = signal.type === 'BUY' ? '🟢' : '🔴';
    
    // Convert reason string into a readable format, handling checklists
    const formattedReason = signal.reason.split('\n').map(r => r.startsWith('✔') || r.startsWith('✖') || r.startsWith('🚨') ? r : `* ${r}`).join('\n');

    const message = `
${emoji} **${signal.type} - ${signal.probabilityLabel}**
Signal ID: \`${signal.id}\`
Confidence: ${signal.confidenceScore}%

Session: ${signal.session}
Market Condition: ${signal.marketCondition}

**Entry**: ${signal.entryPrice.toFixed(2)}
**SL**: ${signal.stopLoss.toFixed(2)}
**TP1**: ${signal.takeProfit1.toFixed(2)} (RR 1:2)
**TP2**: ${signal.takeProfit2.toFixed(2)} (RR 1:3)

Valid Time: ${signal.validTime}
Est. TP Time: ${signal.estimatedTpTime}

**Reason:**
${formattedReason}
    `.trim();

    try {
      await this.bot.sendMessage(config.TELEGRAM_CHAT_ID, message, { parse_mode: 'Markdown' });
      console.log('[Telegram] Signal sent.');
    } catch (e) {
      console.error('[Telegram] Failed to send message', e);
    }
  }
}
