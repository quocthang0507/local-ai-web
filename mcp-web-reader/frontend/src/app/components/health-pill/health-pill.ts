import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-health-pill',
  imports: [CommonModule],
  template: `
    <div
      class="health-pill"
      [ngClass]="{ ok: status() === 'ok', error: status() === 'error' }"
      (click)="checkHealth()"
      style="cursor: pointer;"
      [title]="tooltip()"
    >
      {{ label() }}
    </div>
  `
})
export class HealthPill implements OnInit {
  private readonly apiService = inject(ApiService);

  protected readonly status = signal<'loading' | 'ok' | 'error'>('loading');
  protected readonly label = signal<string>('API');
  protected readonly tooltip = signal<string>('Bấm để kiểm tra hệ thống');

  ngOnInit() {
    this.checkHealth();
  }

  checkHealth() {
    this.status.set('loading');
    this.label.set('Đang kiểm tra...');

    this.apiService.checkHealth().subscribe({
      next: (data) => {
        const ok = data.api === 'ok' && data.searxng === 'ok';
        this.status.set(ok ? 'ok' : 'error');
        this.label.set(ok ? 'API OK' : 'API lỗi');
        const playwrightStatus = data.playwright === 'ok' ? 'Playwright OK' : 'Playwright chưa sẵn sàng';
        this.tooltip.set(`SearXNG: ${data.searxng}; Playwright: ${playwrightStatus}`);
      },
      error: (err) => {
        this.status.set('error');
        this.label.set('API lỗi');
        this.tooltip.set(err.message || String(err));
      }
    });
  }
}
