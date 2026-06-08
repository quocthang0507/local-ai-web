import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';

@Component({
  selector: 'app-error',
  imports: [CommonModule, RouterLink],
  templateUrl: './error.html'
})
export class ErrorComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);

  protected readonly title = signal<string>('404 - Không tìm thấy trang');
  protected readonly message = signal<string>('Trang bạn đang tìm kiếm không tồn tại hoặc đã bị di chuyển.');

  ngOnInit() {
    this.route.queryParams.subscribe(params => {
      const code = params['code'];
      const msg = params['message'];
      
      if (code) {
        if (code === '404') {
          this.title.set('404 - Không tìm thấy trang');
          this.message.set(msg || 'Trang bạn đang tìm kiếm không tồn tại hoặc đã bị di chuyển.');
        } else {
          this.title.set(`Lỗi ${code}`);
          this.message.set(msg || 'Đã xảy ra sự cố kết nối hoặc máy chủ đang gặp trục trặc.');
        }
      } else if (msg) {
        this.title.set('Đã xảy ra sự cố');
        this.message.set(msg);
      }
    });
  }
}
