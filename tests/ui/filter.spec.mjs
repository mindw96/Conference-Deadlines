import { test, expect } from '@playwright/test';

test('past conferences with only a start date follow the past-conference filter', async ({ page }) => {
    await page.clock.install({ time: new Date('2027-01-01T12:00:00Z') });
    const records = [
        { id: 'past-end', name: 'Past range', conf_start_date: '2026-12-20', conf_end_date: '2026-12-31' },
        { id: 'past-start', name: 'Past single day', conf_start_date: '2026-12-31', conf_end_date: null },
        { id: 'today-start', name: 'Today single day', conf_start_date: '2027-01-01', conf_end_date: null }
    ].map(record => ({ ...record, areas: {}, tags: [], deadlines: [], site_url: 'https://example.org' }));
    await page.route('https://tavlqhidtjxgwclhjkje.supabase.co/**', route => {
        const cursor = new URL(route.request().url()).searchParams.get('id');
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(cursor ? [] : records) });
    });

    await page.goto('/');
    await expect(page.locator('.cd-card')).toHaveCount(1);
    await expect(page.locator('.cd-card-title')).toHaveText('Today single day');
    await page.locator('#showPastConf').check();
    await expect(page.locator('.cd-card')).toHaveCount(3);
    await page.locator('#showPastConf').uncheck();
    await expect(page.locator('.cd-card')).toHaveCount(1);
});
