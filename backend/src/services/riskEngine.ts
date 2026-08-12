export class RiskEngine {
  private accountBalance: number = 1000;
  private riskPercent: number = 1.0; // Default 1%

  public getBalance(): number {
    return this.accountBalance;
  }

  public setBalance(balance: number): void {
    if (balance >= 0) {
      this.accountBalance = balance;
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
