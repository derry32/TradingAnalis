import { config } from '../config';
import axios from 'axios';

export interface SentimentResult {
  sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  score: number; // 1-10
}

export class SentimentAnalysis {
  public async analyze(newsText: string): Promise<SentimentResult> {
    if (config.GEMINI_API_KEY) {
      return this.analyzeWithGemini(newsText);
    } else if (config.OPENAI_API_KEY) {
      return this.analyzeWithOpenAI(newsText);
    } else {
      console.warn('[Sentiment] No API Key found, returning mocked sentiment.');
      const text = newsText.toLowerCase();
      if (text.includes('cut') || text.includes('surge') || text.includes('weak')) {
        return { sentiment: 'BULLISH', score: 8 };
      } else if (text.includes('hike') || text.includes('strong')) {
        return { sentiment: 'BEARISH', score: 8 };
      }
      return { sentiment: 'NEUTRAL', score: 5 };
    }
  }

  private async analyzeWithGemini(newsText: string): Promise<SentimentResult> {
    try {
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${config.GEMINI_API_KEY}`,
        {
          contents: [{
            parts: [{
              text: `You are a financial AI analyzing news for XAU/USD (Gold). Reply ONLY in JSON format: {"sentiment": "BULLISH"|"BEARISH"|"NEUTRAL", "score": <number 1-10>}.\nAnalyze this news: ${newsText}`
            }]
          }],
          generationConfig: {
            responseMimeType: "application/json"
          }
        },
        { headers: { 'Content-Type': 'application/json' } }
      );
      
      const content = response.data.candidates[0].content.parts[0].text;
      return JSON.parse(content) as SentimentResult;
    } catch (e) {
      console.error('[Sentiment] Gemini API Error', e);
      return { sentiment: 'NEUTRAL', score: 5 };
    }
  }

  private async analyzeWithOpenAI(newsText: string): Promise<SentimentResult> {
    try {
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: 'You are a financial AI analyzing news for XAU/USD (Gold). Reply ONLY in JSON format: {"sentiment": "BULLISH"|"BEARISH"|"NEUTRAL", "score": <number 1-10>}.'
            },
            {
              role: 'user',
              content: `Analyze this news: ${newsText}`
            }
          ],
          response_format: { type: "json_object" }
        },
        {
          headers: {
            'Authorization': `Bearer ${config.OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      const content = response.data.choices[0].message.content;
      return JSON.parse(content) as SentimentResult;
    } catch (e) {
      console.error('[Sentiment] OpenAI Error', e);
      return { sentiment: 'NEUTRAL', score: 5 };
    }
  }
}
