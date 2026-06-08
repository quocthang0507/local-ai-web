import { Routes } from '@angular/router';
import { HomeComponent } from './pages/home/home';
import { ResultsComponent } from './pages/results/results';
import { TranslateComponent } from './pages/translate/translate';
import { ErrorComponent } from './pages/error/error';

export const routes: Routes = [
  { path: '', component: HomeComponent },
  { path: 'results', component: ResultsComponent },
  { path: 'translate', component: TranslateComponent },
  { path: 'error', component: ErrorComponent },
  { path: '**', component: ErrorComponent }
];
