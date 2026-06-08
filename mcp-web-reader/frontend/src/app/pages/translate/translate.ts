import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';

interface HistoryItem {
  id: string;
  sourceText: string;
  translatedText: string;
  sourceLang: string;
  targetLang: string;
  provider: string;
  timestamp: number;
}

@Component({
  selector: 'app-translate',
  imports: [CommonModule, FormsModule],
  templateUrl: './translate.html'
})
export class TranslateComponent implements OnInit, OnDestroy {
  private readonly apiService = inject(ApiService);
  private readonly router = inject(Router);

  protected readonly sourceText = signal<string>('');
  protected readonly translatedText = signal<string>('');
  protected readonly sourceLang = signal<string>('auto');
  protected readonly targetLang = signal<string>('vi');
  protected readonly provider = signal<string>('auto');

  protected readonly loading = signal<boolean>(false);
  protected readonly error = signal<string>('');

  protected readonly detectedSourceLang = signal<string>('');
  protected readonly activeProvider = signal<string>('');

  protected readonly history = signal<HistoryItem[]>([]);
  protected readonly copySuccess = signal<boolean>(false);

  private readonly translateSubject = new Subject<string>();
  private translateSub?: Subscription;

  protected readonly languageMap: Record<string, string> = {
    vi: "Tiếng Việt",
    en: "Tiếng Anh",
    ja: "Tiếng Nhật",
    ko: "Tiếng Hàn",
    "zh-cn": "Tiếng Trung (Giản thể)",
    zh: "Tiếng Trung (Giản thể)",
    fr: "Tiếng Pháp",
    auto: "Tự động phát hiện"
  };

  ngOnInit() {
    // Load translation history from localStorage
    this.loadHistory();

    // Set up debounced auto-translation
    this.translateSub = this.translateSubject.pipe(
      debounceTime(600),
      distinctUntilChanged()
    ).subscribe(text => {
      this.executeTranslation(text);
    });
  }

  ngOnDestroy() {
    this.translateSub?.unsubscribe();
  }

  onTextChange(text: string) {
    this.sourceText.set(text);
    if (!text.trim()) {
      this.translatedText.set('');
      this.detectedSourceLang.set('');
      this.activeProvider.set('');
      this.error.set('');
      return;
    }
    this.translateSubject.next(text);
  }

  onConfigChange() {
    const text = this.sourceText().trim();
    if (text) {
      this.executeTranslation(text);
    }
  }

  protected getLanguageLabel(code: string): string {
    const key = String(code || '').toLowerCase();
    return this.languageMap[key] || code;
  }

  executeTranslation(text: string) {
    if (!text.trim()) return;

    this.loading.set(true);
    this.error.set('');

    this.apiService.translate(
      text,
      this.sourceLang(),
      this.targetLang(),
      this.provider()
    ).subscribe({
      next: (data) => {
        this.translatedText.set(data.translatedText || '');
        this.detectedSourceLang.set(data.detectedSourceLang || data.sourceLang || '');
        this.activeProvider.set(data.provider || '');
        this.loading.set(false);

        // Add to history
        this.addToHistory(text, data.translatedText || '', data.detectedSourceLang || data.sourceLang || '', this.targetLang(), data.provider || '');
      },
      error: (err) => {
        const errorMsg = err.message || String(err);
        this.router.navigate(['/error'], {
          queryParams: {
            code: 'TRANSLATION_FAILED',
            message: `Không thể hoàn thành bản dịch: ${errorMsg}. Vui lòng kiểm tra dịch vụ dịch thuật (ví dụ: Lingva Translate hoặc Google Translate).`
          }
        });
        this.translatedText.set('');
        this.loading.set(false);
      }
    });
  }

  private loadHistory() {
    try {
      const stored = localStorage.getItem('translate_history');
      if (stored) {
        this.history.set(JSON.parse(stored));
      }
    } catch {
      this.history.set([]);
    }
  }

  private addToHistory(source: string, result: string, sLang: string, tLang: string, prov: string) {
    if (!source.trim() || !result.trim()) return;

    const newItem: HistoryItem = {
      id: Math.random().toString(36).substring(2, 11),
      sourceText: source.trim(),
      translatedText: result.trim(),
      sourceLang: sLang,
      targetLang: tLang,
      provider: prov,
      timestamp: Date.now()
    };

    // Filter duplicates
    const updated = [newItem, ...this.history().filter(h => h.sourceText !== newItem.sourceText || h.targetLang !== newItem.targetLang)].slice(0, 20);
    this.history.set(updated);

    try {
      localStorage.setItem('translate_history', JSON.stringify(updated));
    } catch {}
  }

  loadHistoryItem(item: HistoryItem) {
    this.sourceLang.set(item.sourceLang === 'auto' ? 'auto' : item.sourceLang);
    this.targetLang.set(item.targetLang);
    this.provider.set(item.provider);
    this.sourceText.set(item.sourceText);
    this.translatedText.set(item.translatedText);
    this.detectedSourceLang.set(item.sourceLang);
    this.activeProvider.set(item.provider);
  }

  clearHistory() {
    this.history.set([]);
    try {
      localStorage.removeItem('translate_history');
    } catch {}
  }

  clearSource() {
    this.sourceText.set('');
    this.translatedText.set('');
    this.detectedSourceLang.set('');
    this.activeProvider.set('');
    this.error.set('');
  }

  swapLanguages() {
    const currentSourceText = this.sourceText();
    const currentTranslatedText = this.translatedText();
    const currentSourceLang = this.sourceLang();
    const currentTargetLang = this.targetLang();

    let newSourceLang = currentTargetLang;
    let newTargetLang = currentSourceLang;

    if (currentSourceLang === 'auto') {
      newTargetLang = this.detectedSourceLang() || 'en';
    }

    this.sourceText.set(currentTranslatedText);
    this.translatedText.set(currentSourceText);
    this.sourceLang.set(newSourceLang);
    this.targetLang.set(newTargetLang);

    if (currentTranslatedText.trim()) {
      this.executeTranslation(currentTranslatedText);
    }
  }

  speak(text: string, lang: string) {
    if (!text.trim()) return;

    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const langCode = lang === 'auto' ? (this.detectedSourceLang() || 'en') : lang;
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = langCode;
      window.speechSynthesis.speak(utterance);
    } else {
      alert("Trình duyệt không hỗ trợ chuyển văn bản thành giọng nói.");
    }
  }

  copyToClipboard(text: string) {
    if (!text.trim()) return;

    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        this.copySuccess.set(true);
        setTimeout(() => this.copySuccess.set(false), 2000);
      });
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
        this.copySuccess.set(true);
        setTimeout(() => this.copySuccess.set(false), 2000);
      } catch (err) {
        console.error('Không thể sao chép văn bản', err);
      }
      document.body.removeChild(textarea);
    }
  }
}
