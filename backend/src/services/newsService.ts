import axios from 'axios';

export interface NewsEvent {
  title: string;
  country: string;
  date: string;
  impact: 'High' | 'Medium' | 'Low' | 'Holiday';
  forecast: string;
  previous: string;
  parsedDate?: number;
}

export type NewsSeverity = 'EXTREME' | 'HIGH' | 'MEDIUM';
export type NewsPhase = 'NONE' | 'PRE' | 'DURING' | 'STABILIZATION' | 'POST';

export interface ActiveNewsContext {
  event: NewsEvent;
  severity: NewsSeverity;
  phase: NewsPhase;
}

export class NewsService {
  private newsCache: NewsEvent[] = [];
  private lastFetch: number = 0;

  public async start() {
    await this.fetchNews();
    // Refresh every hour
    setInterval(() => this.fetchNews(), 1000 * 60 * 60);
  }

  private async fetchNews() {
    try {
      const response = await axios.get(
        'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
        { timeout: 10000 }
      );
      if (Array.isArray(response.data)) {
        this.newsCache = response.data;
        this.lastFetch = Date.now();
        console.log(`[NewsService] Successfully fetched ${this.newsCache.length} news events for the week.`);
      }
    } catch (error: any) {
      console.error(`[NewsService] Failed to fetch news:`, error.message);
    }
  }

  public static getNewsSeverity(title: string): NewsSeverity {
    const titleLower = title.toLowerCase();
    // NFP, CPI, Fed, FOMC -> EXTREME (Trigger Pre-News Engine)
    if (titleLower.includes('fomc') || titleLower.includes('powell') || titleLower.includes('fed rate') || titleLower.includes('interest rate') || titleLower.includes('federal funds rate') || titleLower.includes('nfp') || titleLower.includes('non-farm') || titleLower.includes('cpi') || titleLower.includes('inflation')) {
      return 'EXTREME';
    }
    if (titleLower.includes('ppi') || titleLower.includes('unemployment') || titleLower.includes('retail sales')) {
      return 'HIGH';
    }
    return 'MEDIUM'; // Default to Medium for other high impact news
  }

  public getUpcomingHighImpactNews(): NewsEvent | null {
    const now = Date.now();
    const upcoming = this.newsCache
      .filter(event => event.country === 'USD' && event.impact === 'High')
      .map(event => ({ ...event, parsedDate: new Date(event.date).getTime() }))
      .filter(event => {
         const severity = NewsService.getNewsSeverity(event.title);
         const lookback = severity === 'EXTREME' ? (180 * 60 * 1000) : (60 * 60 * 1000); // 180m past for Extreme, 60m for High
         const lookahead = 60 * 60 * 1000; // 60 mins future
         return event.parsedDate > now - lookback && event.parsedDate <= now + lookahead;
      })
      .sort((a, b) => a.parsedDate - b.parsedDate);

    if (upcoming.length > 0) {
      return upcoming[0] as NewsEvent;
    }
    return null;
  }
  
  public getActiveNewsContext(): ActiveNewsContext | null {
    const upcoming = this.getUpcomingHighImpactNews();
    if (!upcoming) return null;
    
    const severity = NewsService.getNewsSeverity(upcoming.title);
    const eventTime = new Date(upcoming.date).getTime();
    const now = Date.now();
    const diffMins = (now - eventTime) / (60 * 1000);

    let phase: NewsPhase = 'NONE';

    if (severity === 'EXTREME') {
      if (diffMins >= -60 && diffMins < 0) phase = 'PRE';
      else if (diffMins >= 0 && diffMins < 30) phase = 'DURING';
      else if (diffMins >= 30 && diffMins < 60) phase = 'STABILIZATION';
      else if (diffMins >= 60 && diffMins <= 180) phase = 'POST';
    } else if (severity === 'HIGH') {
      // High (NFP, CPI): Pause 60 mins before to 30 mins after, then normal
      if (diffMins >= -60 && diffMins < 0) phase = 'PRE';
      else if (diffMins >= 0 && diffMins < 30) phase = 'DURING';
      // No strict Post breakout phase for standard HIGH, back to normal after 30 mins
    } else if (severity === 'MEDIUM') {
      // Medium: Just flag as During for 15 mins
      if (diffMins >= -15 && diffMins < 15) phase = 'DURING';
    }

    if (phase === 'NONE') return null;

    return { event: upcoming, severity, phase };
  }

  // Legacy method for backward compatibility if needed elsewhere
  public isHighImpactWarningActive(): boolean {
    const ctx = this.getActiveNewsContext();
    return ctx !== null && (ctx.phase === 'PRE' || ctx.phase === 'DURING');
  }

  public async fetchLatestNews(): Promise<any[]> {
    try {
      // Import config dynamically to avoid circular dependencies if any, but let's just require it.
      const { config } = require('../config');
      const response = await axios.get(
        `https://finnhub.io/api/v1/news?category=general&token=${config.FINNHUB_API_KEY}`,
        { timeout: 10000 }
      );
      if (Array.isArray(response.data)) {
        return response.data.slice(0, 5); // Return top 5 latest news
      }
      return [];
    } catch (error: any) {
      // Finnhub is deprecated in favor of TwelveData, so we silently ignore 401 errors to prevent log spam
      return [];
    }
  }
}
