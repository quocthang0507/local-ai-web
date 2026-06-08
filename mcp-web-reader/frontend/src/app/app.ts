import { Component, signal } from '@angular/core';
import { RouterOutlet, RouterLink } from '@angular/router';
import { HealthPill } from './components/health-pill/health-pill';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, HealthPill],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  protected readonly title = signal('Local AI Search');
}
