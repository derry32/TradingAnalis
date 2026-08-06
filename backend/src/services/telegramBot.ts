import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config';
import { Signal } from './signalGenerator';

export class TelegramService {
  private bot: TelegramBot | null = null;

  private onResetCallback: (() => { success: boolean; count: number }) | null = null;
  private getStatusCallback: (() => any) | null = null;

  constructor() {
    if (config.TELEGRAM_BOT_TOKEN) {
      this.bot = new TelegramBot(config.TELEGRAM_BOT_TOKEN, { polling: true });
      console.log('[Telegram] Bot started.');
      
      this.bot.onText(/\/start/, (msg) => {
        const chatId = msg.chat.id;
        this.bot?.sendMessage(chatId, `👋 *Selamat datang di AurumAI Trading Engine!*\n\nCommand yang tersedia:\n• /status - Cek status AI, Market & SL Harian\n• /reset_ea - Reset Guard & Buka Kunci Robot MT5\n• /help - Panduan penggunaan`, { parse_mode: 'Markdown' });
      });

      this.bot.onText(/\/reset|\/reset_ea|\/reset_guard/, (msg) => {
        const chatId = msg.chat.id;
        if (this.onResetCallback) {
          const res = this.onResetCallback();
          this.bot?.sendMessage(chatId, `✅ *Drawdown Guard & Robot MT5 Berhasil Direset!*\n\n• *SL Hari Ini*: 0\n• *Status*: 🟢 AKTIF\n• *Robot MT5*: Kunci Sleep dibuka, siap menerima sinyal baru!`, { parse_mode: 'Markdown' });
        } else {
          this.bot?.sendMessage(chatId, `⚠️ Reset callback belum terhubung.`);
        }
      });

      this.bot.onText(/\/status/, (msg) => {
        const chatId = msg.chat.id;
        if (this.getStatusCallback) {
          const s = this.getStatusCallback();
          const guardIcon = s.isGuardActive ? '⛔ SLEEP / TERKUNCI' : '🟢 AKTIF';
          const msgText = `📊 *Status Sistem AurumAI:*\n\n` +
            `• *Session*: ${s.session}\n` +
            `• *Status AI*: ${guardIcon}\n` +
            `• *SL Hari Ini*: ${s.dailySLCount} / ${s.maxDailySL}\n` +
            `• *Sniper Trade*: ${s.activeSniper ? '🔥 ' + s.activeSniper.type + ' @ ' + s.activeSniper.entryPrice : 'Standby'}\n` +
            `• *Scalper Trade*: ${s.activeScalper ? '⚡ ' + s.activeScalper.type + ' @ ' + s.activeScalper.entryPrice : 'Standby'}\n\n` +
            `_Gunakan /reset_ea untuk mengaktifkan kembali jika terkunci._`;
          this.bot?.sendMessage(chatId, msgText, { parse_mode: 'Markdown' });
        }
      });
    } else {
      console.warn('[Telegram] No Bot Token. Telegram notifications disabled.');
    }
  }

  public setOnReset(cb: () => { success: boolean; count: number }) {
    this.onResetCallback = cb;
  }

  public setGetStatus(cb: () => any) {
    this.getStatusCallback = cb;
  }


  public async sendSignal(signal: Signal) {
    if (!this.bot || !config.TELEGRAM_CHAT_ID) {
      console.log('[Telegram Mock Signal]', signal);
      return;
    }

    const emoji = signal.type === 'BUY' ? '🟢' : '🔴';
    const formattedTime = new Date(signal.timestamp).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' }) + ' WIB';
    
    // Convert reason string into a readable format, handling checklists
    const formattedReason = signal.reason.split('\n').map(r => r.startsWith('✔') || r.startsWith('✖') || r.startsWith('🚨') ? r : `- ${r}`).join('\n').replace(/_/g, ' ');

    const safeStrategy = signal.strategy.replace(/_/g, ' ');
    const safeMarketCondition = signal.marketCondition.replace(/_/g, ' ');
    const safeSetupType = (signal.setupType || 'Trend Setup').replace(/_/g, ' ');
    const safeMarketPhase = (signal.marketPhase || 'N/A').replace(/_/g, ' ');
    const safeExecutionType = signal.executionType || '⚡ INSTANT ENTRY';

    const message = `
🚨 [${safeStrategy} V2] 🚨
${emoji} *${signal.type} - ${signal.probabilityLabel}*
🎯 *Setup*: ${safeSetupType}
⚡ *Eksekusi*: ${safeExecutionType}
Phase: ${safeMarketPhase}
Signal ID: \`${signal.id}\`
Time: ${formattedTime}
Confidence: ${signal.confidenceScore}/100

Session: ${signal.session}
Market: ${safeMarketCondition}

📍 *Entry Zone*: ${signal.entryZone}
💵 *Market Price*: ${signal.entryPrice.toFixed(2)}
🛑 *SL*: ${signal.stopLoss.toFixed(2)}
🎯 *TP1*: ${signal.takeProfit1.toFixed(2)} (RR 1:1.8)
🚀 *TP2*: ${signal.takeProfit2.toFixed(2)} (RR 1:2.5)

Valid Time: ${signal.validTime}
Est. TP Time: ${signal.estimatedTpTime}

*Reason & Confluence:*
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
