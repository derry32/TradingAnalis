import axios from 'axios';

export interface NewsEvent {
  title: string;
  country: string;
  date: string;
  impact: 'High' | 'Medium' | 'Low' | 'Holiday';
  forecast: string;
  previous: string;
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
      const response = await axios.get('https://nfs.faireconomy.media/ff_calendar_thisweek.json');
      if (Array.isArray(response.data)) {
        this.newsCache = response.data;
        this.lastFetch = Date.now();
        console.log(`[NewsService] Successfully fetched ${this.newsCache.length} news events for the week.`);
      }
    } catch (error: any) {
      console.error(`[NewsService] Failed to fetch news:`, error.message);
    }
  }

  public getUpcomingHighImpactNews(): NewsEvent | null {
    const now = Date.now();
    const upcoming = this.newsCache
      .filter(event => event.country === 'USD' && event.impact === 'High')
      .map(event => ({ ...event, parsedDate: new Date(event.date).getTime() }))
      .filter(event => event.parsedDate > now - (30 * 60 * 1000)) // Include past 30 mins (still in warning window)
      .sort((a, b) => a.parsedDate - b.parsedDate);

    if (upcoming.length > 0) {
      return upcoming[0];
    }
    return null;
  }
  
  public isHighImpactWarningActive(): boolean {
    const upcoming = this.getUpcomingHighImpactNews();
    if (!upcoming) return false;
    
    const eventTime = new Date(upcoming.date).getTime();
    const now = Date.now();
    
    // Warning window: 30 minutes before and 30 minutes after
    const windowStart = eventTime - (30 * 60 * 1000);
    const windowEnd = eventTime + (30 * 60 * 1000);
    
    return now >= windowStart && now <= windowEnd;
  }
}
