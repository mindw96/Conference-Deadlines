import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
    testDir: './tests/ui', fullyParallel: false, workers: 1, timeout: 30000,
    use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure' },
    projects: [
        {name:'desktop',use:{...devices['Desktop Chrome']}},
        {name:'mobile',use:{...devices['Pixel 7']}}
    ],
    webServer:{command:'node scripts/serve.mjs',url:'http://127.0.0.1:4173',reuseExistingServer:!process.env.CI}
});
