export interface AccountState {
  balance: number;
  equity: number;
  freeMargin: number;
  timestamp: number;
}

export class RiskEngine {
  private accountBalance: number = 0;
  private accountEquity: number = 0;
  private freeMargin: number = 0;
  private riskPercent: number = 1.0; // Default 1%

  // Drawdown tracking
  private initialDailyBalance: number = 0;
  private lastDateWIB: string = '';
  private consecutiveLosses: number = 0;

  private getTodayWIB(): string {
    return new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta' });
  }

  public updateAccount(state: AccountState): void {
    if (state.balance > 0) {
      this.accountBalance = state.balance;
      this.accountEquity = state.equity;
      this.freeMargin = state.freeMargin;

      const today = this.getTodayWIB();
      if (this.lastDateWIB !== today) {
        this.lastDateWIB = today;
        // On new day, reset daily starting balance
        this.initialDailyBalance = this.accountBalance;
        this.consecutiveLosses = 0;
      }
    }
  }

  public getBalance(): number {
    return this.accountBalance;
  }

  public getEquity(): number {
    return this.accountEquity;
  }

  // Fallback for manual updates
  public setBalance(balance: number): void {
    if (balance >= 0) {
      this.accountBalance = balance;
      this.accountEquity = balance; // approximation
    }
  }

  public getRiskPercent(): number {
    return this.riskPercent;
  }

  public setRiskPercent(percent: number): void {
    if (percent > 0 && percent <= 10) {
      this.riskPercent = percent;
    }
  }

  public registerTradeResult(isWin: boolean): void {
    if (!isWin) {
      this.consecutiveLosses++;
    } else {
      this.consecutiveLosses = 0; // reset streak on win
    }
  }

  public getConsecutiveLosses(): number {
    return this.consecutiveLosses;
  }

  public getDailyDrawdownPercent(): number {
    if (this.initialDailyBalance <= 0) return 0;
    const drawdown = this.initialDailyBalance - this.accountEquity;
    if (drawdown <= 0) return 0; // No drawdown (in profit)
    return (drawdown / this.initialDailyBalance) * 100;
  }

  public isTradingBlocked(): { blocked: boolean; reason?: string } {
    const ddPercent = this.getDailyDrawdownPercent();
    if (ddPercent >= 3.0) {
      return { blocked: true, reason: `Daily Drawdown Limit Hit: -${ddPercent.toFixed(2)}% (Max 3%)` };
    }
    if (this.consecutiveLosses >= 3) {
      return { blocked: true, reason: `Loss Streak PAUSE: 3 Consecutive Losses` };
    }
    return { blocked: false };
  }

  public resetGuard(): void {
    this.consecutiveLosses = 0;
    // We don't reset initialDailyBalance so the 3% limit remains active unless manual intervention bypasses it, 
    // but typically resetGuard is for the streak. If they want to bypass daily DD, they can just restart or we can add a bypass flag.
    // For now, reset consecutive losses.
  }

  /**
   * Calculates the lot size given a Stop Loss distance in price (not pips).
   * For XAUUSD, a $1 movement = 100 pips if 1 pip = 0.01, but usually 1 standard pip = $0.1.
   * Assuming 1 standard lot = 100 oz. So $1 move on 1 lot = $100.
   * Total Risk $ = Balance * (RiskPercent / 100).
   * Lot Size = Total Risk $ / (SL Distance $ * 100).
   * 
   * Example: Balance $1000, Risk 1% = $10. SL = $2.00 distance.
   * Lot Size = 10 / (2.00 * 100) = 10 / 200 = 0.05.
   */
  public calculateLotSize(slDistancePrice: number): number {
    if (this.accountBalance <= 0 || slDistancePrice <= 0) return 0;

    const riskAmount = this.accountBalance * (this.riskPercent / 100);
    // standard lot = 100 oz. So $1 movement in gold = $100 profit/loss per 1.00 lot
    const lossPerLot = slDistancePrice * 100;

    const lot = riskAmount / lossPerLot;

    // Round down to nearest 0.01 to ensure we don't exceed the risk budget
    return Math.floor(lot * 100) / 100;
  }
}

export const riskEngine = new RiskEngine();
