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

    const emoji = signal.type === 'BUY' ? '🟢 BUY' : '🔴 SELL';
    const message = `
🚨 *SINYAL TRADING XAU/USD* 🚨
${emoji}

Entry Price: ${signal.entryPrice.toFixed(2)}
Stop Loss: ${signal.stopLoss.toFixed(2)}
Take Profit: ${signal.takeProfit.toFixed(2)}

📝 Alasan: ${signal.reason}
⏰ Waktu: ${signal.timestamp}

⚠️ *Disclaimer: Not Financial Advice.*
`;

    try {
      await this.bot.sendMessage(config.TELEGRAM_CHAT_ID, message, { parse_mode: 'Markdown' });
      console.log('[Telegram] Signal sent.');
    } catch (e) {
      console.error('[Telegram] Failed to send message', e);
    }
  }
}
