import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ApiService } from '../../services/api.service';
import { Subscription } from 'rxjs';

interface SearchResult {
  id: string;
  mode: string;
  title: string;
  url: string;
  source?: string;
  snippet?: string;
  code?: string;
  lang?: string;
  score?: number;
  sourceTier?: string;
}

@Component({
  selector: 'app-results',
  imports: [CommonModule, FormsModule],
  templateUrl: './results.html'
})
export class ResultsComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly apiService = inject(ApiService);
  private readonly sanitizer = inject(DomSanitizer);

  protected readonly query = signal<string>('');
  protected readonly mode = signal<string>('web');
  protected readonly timeRange = signal<string>('');
  protected readonly maxResults = signal<number>(8);
  protected readonly includeUnofficial = signal<boolean>(false);

  protected readonly results = signal<SearchResult[]>([]);
  protected readonly loading = signal<boolean>(false);
  protected readonly error = signal<string>('');

  protected readonly activeIndex = signal<number>(-1);
  protected readonly detailLoading = signal<boolean>(false);
  protected readonly detailError = signal<string>('');
  protected readonly detailData = signal<any>(null);

  protected placeholder = 'Tìm kiếm...';
  private queryParamSub?: Subscription;

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
    this.queryParamSub = this.route.queryParams.subscribe(params => {
      const q = params['q'] || '';
      const m = params['mode'] || 'web';
      const tr = params['timeRange'] || '';
      const mr = Number(params['maxResults'] || 8);
      const iu = params['includeUnofficial'] === 'true';

      this.query.set(q);
      this.mode.set(m);
      this.timeRange.set(tr);
      this.maxResults.set(mr);
      this.includeUnofficial.set(iu);

      this.updatePlaceholder();

      if (q.trim()) {
        this.executeSearch(q, m, tr, mr, iu);
      } else {
        this.results.set([]);
      }
    });
  }

  ngOnDestroy() {
    this.queryParamSub?.unsubscribe();
  }

  private updatePlaceholder() {
    const activeMode = this.mode();
    if (activeMode === 'legal' || activeMode === 'procedure') {
      this.placeholder = 'Tìm văn bản, số hiệu, thủ tục, hồ sơ...';
    } else if (activeMode === 'code') {
      this.placeholder = 'Tìm ví dụ mã nguồn, thư viện, lỗi, implementation...';
    } else if (activeMode === 'pdf') {
      this.placeholder = 'Tìm tài liệu PDF, báo cáo, văn bản đính kèm...';
    } else {
      this.placeholder = 'Tìm mã nguồn, văn bản pháp luật, thủ tục hành chính...';
    }
  }

  setMode(newMode: string) {
    if (newMode === 'translate') {
      this.router.navigate(['/translate']);
    } else {
      this.mode.set(newMode);
      this.updatePlaceholder();
      this.triggerSearch();
    }
  }

  triggerSearch(event?: Event) {
    if (event) {
      event.preventDefault();
    }
    const q = this.query().trim();
    if (!q) return;

    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        q,
        mode: this.mode(),
        timeRange: this.timeRange() || undefined,
        maxResults: this.maxResults(),
        includeUnofficial: this.includeUnofficial() || undefined
      },
      queryParamsHandling: 'merge'
    });
  }

  private executeSearch(query: string, mode: string, timeRange: string, maxResults: number, includeUnofficial: boolean) {
    this.loading.set(true);
    this.error.set('');
    this.results.set([]);
    this.activeIndex.set(-1);
    this.detailData.set(null);

    let searchObs;
    if (mode === 'code') {
      searchObs = this.apiService.searchCode(query, maxResults, this.detectLanguageHint(query));
    } else if (mode === 'legal' || mode === 'procedure') {
      const legalMode = mode === 'procedure' ? 'procedure' : 'law';
      searchObs = this.apiService.searchLegal(query, maxResults, legalMode, timeRange, includeUnofficial);
    } else {
      searchObs = this.apiService.searchWeb(mode === 'pdf' ? `${query} filetype:pdf` : query, maxResults, timeRange);
    }

    searchObs.subscribe({
      next: (data: any) => {
        const hits = data.results || [];
        const mapped: SearchResult[] = hits.map((item: any, idx: number) => {
          if (mode === 'code') {
            return {
              id: `${idx}-${item.url}`,
              mode: 'code',
              title: `${item.lang || 'Code'} · ${item.source || 'source'}`,
              url: item.url,
              source: item.source,
              snippet: item.code || '',
              code: item.code || '',
              lang: item.lang,
              score: item.score
            };
          } else {
            return {
              id: `${idx}-${item.url}`,
              mode: mode,
              title: item.title || item.url,
              url: item.url,
              source: item.source,
              snippet: item.snippet || '',
              sourceTier: item.sourceTier,
              score: item.score
            };
          }
        });
        this.results.set(mapped);
        this.loading.set(false);
      },
      error: (err) => {
        const errorMsg = err.message || String(err);
        this.router.navigate(['/error'], {
          queryParams: {
            code: '500',
            message: `Không thể hoàn thành tìm kiếm: ${errorMsg}. Vui lòng kiểm tra kết nối mạng và đảm bảo dịch vụ SearXNG trong Docker đang hoạt động.`
          }
        });
        this.loading.set(false);
      }
    });
  }

  selectResult(index: number) {
    const result = this.results()[index];
    if (!result) return;

    this.activeIndex.set(index);
    this.detailLoading.set(true);
    this.detailError.set('');
    this.detailData.set(null);

    if (result.mode === 'code') {
      this.detailData.set({
        kicker: 'Đoạn mã',
        title: result.title,
        url: result.url,
        tags: [
          { text: result.lang || 'code', className: 'code' },
          { text: result.source || 'source' }
        ],
        code: result.code
      });
      this.detailLoading.set(false);
      return;
    }

    if (result.mode === 'legal' || result.mode === 'procedure') {
      this.apiService.fetchLegalDetail(result.url, 24000, false).subscribe({
        next: (data) => {
          const meta = data.metadata || {};
          this.detailData.set({
            kicker: result.mode === 'procedure' ? 'Thủ tục hành chính' : 'Văn bản pháp luật',
            title: data.title || meta.title || result.title,
            url: data.finalUrl || result.url,
            tags: [
              {
                text: meta.sourceTier === 'official' ? 'Nguồn chính thức' : 'Nguồn tham khảo',
                className: meta.sourceTier === 'official' ? 'official' : 'warn'
              },
              { text: meta.confidence ? `Metadata ${meta.confidence}` : 'Metadata' }
            ],
            meta: [
              { label: 'Loại văn bản', value: meta.documentType },
              { label: 'Số hiệu', value: meta.documentNumber },
              { label: 'Cơ quan', value: meta.authority },
              { label: 'Ngày ban hành', value: meta.issuedDate },
              { label: 'Ngày hiệu lực', value: meta.effectiveDate },
              { label: 'Tín hiệu hiệu lực', value: meta.statusSignals },
              { label: 'Văn bản được viện dẫn', value: meta.citations?.slice(0, 8) }
            ],
            text: data.text || data.markdown || result.snippet
          });
          this.detailLoading.set(false);
        },
        error: (err) => {
          this.detailError.set(err.message || String(err));
          this.detailLoading.set(false);
        }
      });
      return;
    }

    if (result.mode === 'pdf') {
      this.apiService.fetchDocument(result.url).subscribe({
        next: (data) => {
          this.detailData.set({
            kicker: 'Tài liệu PDF',
            title: data.info?.Title || result.title,
            url: data.finalUrl || result.url,
            meta: [
              { label: 'Số trang', value: data.numPages ? String(data.numPages) : '' },
              { label: 'Loại nội dung', value: data.contentType || 'PDF' }
            ],
            text: data.text
          });
          this.detailLoading.set(false);
        },
        error: (err) => {
          this.detailError.set(err.message || String(err));
          this.detailLoading.set(false);
        }
      });
      return;
    }

    // Default Web Search detail fetching with fallback
    this.apiService.fetchMarkdown(result.url).subscribe({
      next: (data) => this.renderWebDetail(result, data),
      error: () => {
        this.apiService.fetchStatic(result.url).subscribe({
          next: (data) => this.renderWebDetail(result, data),
          error: () => {
            this.apiService.fetchRenderedMarkdown(result.url).subscribe({
              next: (data) => this.renderWebDetail(result, data),
              error: (err) => {
                this.detailError.set(err.message || String(err));
                this.detailLoading.set(false);
              }
            });
          }
        });
      }
    });
  }

  private renderWebDetail(result: SearchResult, data: any) {
    this.detailData.set({
      kicker: 'Trang web',
      title: data.title || result.title,
      url: data.finalUrl || result.url,
      meta: [
        { label: 'Nguồn', value: result.source || '' },
        { label: 'Loại nội dung', value: data.contentType || data.mode || '' }
      ],
      markdown: data.markdown,
      text: data.text || ''
    });
    this.detailLoading.set(false);
  }

  private detectLanguageHint(query: string): string | undefined {
    const lower = query.toLowerCase();
    if (lower.includes("typescript") || lower.includes("ts ")) return "typescript";
    if (lower.includes("python") || lower.includes("django") || lower.includes("fastapi")) return "python";
    if (lower.includes("javascript") || lower.includes("node") || lower.includes("express")) return "javascript";
    if (lower.includes("golang") || lower.includes(" go ")) return "go";
    if (lower.includes("rust")) return "rust";
    if (lower.includes("java ") || lower.includes("spring")) return "java";
    return undefined;
  }

  protected formatUrl(url: string): string {
    try {
      const parsed = new URL(url);
      const path = `${parsed.hostname}${parsed.pathname}`.replace(/\/$/, "");
      return path.length > 96 ? `${path.slice(0, 95)}…` : path;
    } catch {
      return url.length > 96 ? `${url.slice(0, 95)}…` : url;
    }
  }

  protected getSafeHtml(md: string): SafeHtml {
    const rawHtml = this.renderMarkdownToHtml(md);
    return this.sanitizer.bypassSecurityTrustHtml(rawHtml);
  }

  protected getLanguageLabel(code: string): string {
    const key = String(code || '').toLowerCase();
    return this.languageMap[key] || code;
  }

  private renderMarkdownToHtml(markdown: string): string {
    const lines = String(markdown || '').replace(/\r/g, '').split('\n');
    let i = 0;
    let html = '';

    const isTableSeparator = (line: string) => /^\s*\|?[\s:-]+\|[\s|:-]*\s*$/.test(line);
    const splitTableLine = (line: string) => {
      return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
    };
    const escapeHtml = (text: string) => {
      return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    };
    
    const renderInlineMarkdown = (text: string): string => {
      let escaped = escapeHtml(text);
      escaped = escaped.replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, '<img class="markdown-image" src="$2" alt="$1" loading="lazy" decoding="async" />');
      escaped = escaped.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
      escaped = escaped.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
      escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      escaped = escaped.replace(/\*([^*]+)\*/g, '<em>$1</em>');
      return escaped;
    };

    while (i < lines.length) {
      const line = lines[i];

      if (!line.trim()) {
        i++;
        continue;
      }

      const imgMatch = line.match(/^\s*!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)\s*$/);
      if (imgMatch) {
        html += `<figure class="markdown-figure">
          <img class="markdown-image" src="${imgMatch[2]}" alt="${imgMatch[1]}" loading="lazy" decoding="async" />
          ${imgMatch[1] ? `<figcaption>${escapeHtml(imgMatch[1])}</figcaption>` : ''}
        </figure>`;
        i++;
        continue;
      }

      const fence = line.match(/^```([A-Za-z0-9_+-]*)\s*$/);
      if (fence) {
        const codeLines = [];
        i++;
        while (i < lines.length && !/^```\s*$/.test(lines[i])) {
          codeLines.push(lines[i]);
          i++;
        }
        if (i < lines.length) i++;
        const langClass = fence[1] ? ` data-lang="${fence[1]}"` : '';
        html += `<pre class="code-block"><code${langClass}>${escapeHtml(codeLines.join('\n'))}</code></pre>`;
        continue;
      }

      const heading = line.match(/^(#{1,4})\s+(.+)$/);
      if (heading) {
        const level = Math.min(heading[1].length + 2, 6);
        html += `<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`;
        i++;
        continue;
      }

      if (i + 1 < lines.length && line.includes('|') && isTableSeparator(lines[i + 1])) {
        const headers = splitTableLine(line);
        let tableHtml = '<table><thead><tr>';
        headers.forEach(h => {
          tableHtml += `<th>${renderInlineMarkdown(h)}</th>`;
        });
        tableHtml += '</tr></thead><tbody>';

        i += 2;
        while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
          const cells = splitTableLine(lines[i]);
          tableHtml += '<tr>';
          cells.forEach(c => {
            tableHtml += `<td>${renderInlineMarkdown(c)}</td>`;
          });
          tableHtml += '</tr>';
          i++;
        }
        tableHtml += '</tbody></table>';
        html += tableHtml;
        continue;
      }

      if (/^\s*[-*]\s+/.test(line)) {
        html += '<ul>';
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
          const itemText = lines[i].replace(/^\s*[-*]\s+/, '');
          html += `<li>${renderInlineMarkdown(itemText)}</li>`;
          i++;
        }
        html += '</ul>';
        continue;
      }

      if (/^\s*\d+\.\s+/.test(line)) {
        html += '<ol>';
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
          const itemText = lines[i].replace(/^\s*\d+\.\s+/, '');
          html += `<li>${renderInlineMarkdown(itemText)}</li>`;
          i++;
        }
        html += '</ol>';
        continue;
      }

      if (/^\s*>\s+/.test(line)) {
        html += '<blockquote>';
        const quoteLines = [];
        while (i < lines.length && /^\s*>\s+/.test(lines[i])) {
          quoteLines.push(lines[i].replace(/^\s*>\s+/, ''));
          i++;
        }
        html += renderInlineMarkdown(quoteLines.join(' '));
        html += '</blockquote>';
        continue;
      }

      const paragraphLines = [];
      while (
        i < lines.length &&
        lines[i].trim() &&
        !/^```/.test(lines[i]) &&
        !/^(#{1,4})\s+/.test(lines[i]) &&
        !/^\s*[-*]\s+/.test(lines[i]) &&
        !/^\s*\d+\.\s+/.test(lines[i]) &&
        !/^\s*>\s+/.test(lines[i])
      ) {
        if (i + 1 < lines.length && lines[i].includes('|') && isTableSeparator(lines[i + 1])) break;
        paragraphLines.push(lines[i]);
        i++;
      }

      if (paragraphLines.length > 0) {
        html += `<p>${renderInlineMarkdown(paragraphLines.join(' '))}</p>`;
      } else {
        i++;
      }
    }

    if (!html) {
      return '<p>Không có nội dung để hiển thị.</p>';
    }

    return html;
  }
}
