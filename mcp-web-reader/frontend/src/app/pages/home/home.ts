import { Component, inject, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

@Component({
  selector: 'app-home',
  imports: [CommonModule, FormsModule],
  templateUrl: './home.html'
})
export class HomeComponent {
  private readonly router = inject(Router);

  protected readonly mode = signal<'web' | 'code' | 'legal' | 'procedure' | 'pdf'>('web');
  protected readonly query = signal<string>('');
  protected readonly timeRange = signal<string>('');
  protected readonly maxResults = signal<number>(8);
  protected readonly includeUnofficial = signal<boolean>(false);

  protected readonly placeholder = signal<string>('Tìm mã nguồn, văn bản pháp luật, thủ tục hành chính...');

  constructor() {
    effect(() => {
      const activeMode = this.mode();
      if (activeMode === 'legal' || activeMode === 'procedure') {
        this.placeholder.set('Tìm văn bản, số hiệu, thủ tục, hồ sơ...');
      } else if (activeMode === 'code') {
        this.placeholder.set('Tìm ví dụ mã nguồn, thư viện, lỗi, implementation...');
      } else if (activeMode === 'pdf') {
        this.placeholder.set('Tìm tài liệu PDF, báo cáo, văn bản đính kèm...');
      } else {
        this.placeholder.set('Tìm mã nguồn, văn bản pháp luật, thủ tục hành chính...');
      }
    });
  }

  setMode(newMode: 'web' | 'code' | 'legal' | 'procedure' | 'pdf' | 'translate') {
    if (newMode === 'translate') {
      this.router.navigate(['/translate']);
    } else {
      this.mode.set(newMode);
    }
  }

  onSearch(event?: Event) {
    if (event) {
      event.preventDefault();
    }
    const q = this.query().trim();
    if (!q) return;

    this.router.navigate(['/results'], {
      queryParams: {
        q,
        mode: this.mode(),
        timeRange: this.timeRange() || undefined,
        maxResults: this.maxResults(),
        includeUnofficial: this.includeUnofficial() || undefined
      }
    });
  }
}
