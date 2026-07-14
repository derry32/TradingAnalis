export interface NewsArticle {
  title: string;
  description: string;
  publishedAt: string;
}

export class NewsService {
  public async fetchLatestNews(): Promise<NewsArticle[]> {
    // Pada tahap MVP tanpa langganan API berbayar, kita menggunakan data mock.
    // Pada implementasi produksi, gunakan axios untuk memanggil News API/Marketaux.
    return [
      {
        title: "Federal Reserve Announces Surprise Rate Cut",
        description: "The Fed has cut interest rates by 25 basis points, weakening the US Dollar.",
        publishedAt: new Date().toISOString()
      },
      {
        title: "Gold Prices Surge on Safe-Haven Demand",
        description: "Investors flock to gold amidst rising geopolitical tensions.",
        publishedAt: new Date().toISOString()
      }
    ];
  }
}
