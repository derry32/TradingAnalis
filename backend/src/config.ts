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
  MT5_BRIDGE_TOKEN: process.env.MT5_BRIDGE_TOKEN || 'aurum_secret_bridge_token_2026',

  // === BASKET ENGINE v2 (AurumAI v2 — FROZEN) ===
  // Entry Thresholds (tunable via env, no code change needed)
  INITIAL_ENTRY_THRESHOLD: process.env.INITIAL_ENTRY_THRESHOLD ? parseInt(process.env.INITIAL_ENTRY_THRESHOLD) : 70,
  ADD_2_THRESHOLD:         process.env.ADD_2_THRESHOLD         ? parseInt(process.env.ADD_2_THRESHOLD)         : 75,
  ADD_3_THRESHOLD:         process.env.ADD_3_THRESHOLD         ? parseInt(process.env.ADD_3_THRESHOLD)         : 80,

  // ATR Regime Bounds (XAUUSD M5)
  ATR_REGIME_LOW_MAX:     4.5,   // ATR < 4.5  → LOW   (require higher score)
  ATR_REGIME_NORMAL_MAX:  12.0,  // ATR < 12.0 → NORMAL
  ATR_REGIME_HIGH_MAX:    25.0,  // ATR < 25.0 → HIGH
  // ATR >= 25.0 → EXTREME (Hard Veto, already handled in signalGenerator)

  // Basket Risk Limits (% of equity)
  BASKET_RISK_DEFAULT:    1.5,   // < 1.5%  → ADD allowed
  BASKET_RISK_HARD_LIMIT: 2.0,   // > 2.0%  → CLOSE ALL (Hard Veto)

  // Basket Mechanics
  MIN_BASKET_RR:          1.3,   // Minimum RR before entry / ADD
  MAX_POSITIONS:          3,     // Max positions per basket
  MIN_SPACING_ATR_MULT:   0.5,   // Min distance between entries = 0.5 × ATR M5
  ACK_TIMEOUT_MS:         5000,  // ms before state → ERROR/DESYNC if no MT5 ACK
};
