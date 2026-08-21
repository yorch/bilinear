// Scratch config: this sandbox ships Playwright browser build 1194 while the
// repo's @playwright/test expects 1228, so point chromium at the installed
// binary. Never committed.
import base from './playwright.config';

export default {
  ...base,
  projects: base.projects?.map(p => ({
    ...p,
    use: { ...p.use, launchOptions: { executablePath: '/opt/pw-browsers/chromium' } },
  })),
};
