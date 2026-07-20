import dotenv from 'dotenv';
dotenv.config();

export const config = {
  PORT: process.env.PORT || 3001,
  TWELVEDATA_API_KEY: process.env.TWELVEDATA_API_KEY || '',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '',
  // Database
  SUPABASE_URL: process.env.SUPABASE_URL?.replace(/\/rest\/v1\/?$/, '') || '',
  SUPABASE_KEY: process.env.SUPABASE_KEY || '',
  // Risk Management
  RISK_REWARD_RATIO: 2, // 1:2
  STOP_LOSS_PIPS: process.env.STOP_LOSS_PIPS ? parseInt(process.env.STOP_LOSS_PIPS) : 30, // Standar 30 pips
  TIMEFRAME_MINUTES: 5, // Timeframe M5 sesuai request
};
