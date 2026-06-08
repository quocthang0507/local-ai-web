import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private readonly http = inject(HttpClient);

  searchWeb(query: string, maxResults: number, timeRange?: string): Observable<any> {
    return this.http.post('/api/search', {
      query,
      max_results: maxResults,
      time_range: timeRange || undefined
    });
  }

  searchCode(query: string, maxSnippets: number, langHint?: string): Observable<any> {
    return this.http.post('/api/search/code', {
      query,
      max_snippets: maxSnippets,
      language_hint: langHint || undefined
    });
  }

  searchLegal(query: string, maxResults: number, mode: 'law' | 'procedure' | 'administrative' | 'all', timeRange?: string, includeUnofficial = false): Observable<any> {
    return this.http.post('/api/search/vietnam-legal', {
      query,
      max_results: maxResults,
      mode: mode === 'procedure' ? 'procedure' : (mode === 'administrative' ? 'administrative' : (mode === 'law' ? 'law' : 'all')),
      time_range: timeRange || undefined,
      include_unofficial: includeUnofficial
    });
  }

  fetchLegalDetail(url: string, maxChars = 24000, render = false): Observable<any> {
    return this.http.post('/api/fetch/vietnam-legal', {
      url,
      max_chars: maxChars,
      render
    });
  }

  fetchDocument(url: string, maxChars = 30000): Observable<any> {
    return this.http.post('/api/fetch/document', {
      url,
      max_chars: maxChars
    });
  }

  fetchMarkdown(url: string, maxChars = 36000): Observable<any> {
    return this.http.post('/api/fetch/markdown', {
      url,
      max_chars: maxChars
    });
  }

  fetchStatic(url: string, maxChars = 24000): Observable<any> {
    return this.http.post('/api/fetch/static', {
      url,
      max_chars: maxChars
    });
  }

  fetchRenderedMarkdown(url: string, maxChars = 36000, waitMs = 1000, scrollSteps = 2): Observable<any> {
    return this.http.post('/api/fetch/rendered/markdown', {
      url,
      max_chars: maxChars,
      wait_ms: waitMs,
      scroll_steps: scrollSteps
    });
  }

  translate(text: string, sourceLang: string, targetLang: string, provider: string): Observable<any> {
    return this.http.post('/api/translate', {
      text,
      source_lang: sourceLang,
      target_lang: targetLang,
      provider
    });
  }

  checkHealth(): Observable<any> {
    return this.http.get('/health');
  }
}
