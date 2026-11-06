import { test, expect } from '@playwright/test';

test('researched conference snapshot distinguishes upcoming, unpublished and past deadlines', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-11-07T00:00:00Z') });
    let liveRequests = 0;
    await page.route('https://tavlqhidtjxgwclhjkje.supabase.co/**', route => {
        liveRequests++;
        return route.abort();
    });
    await page.goto('/?demo=1');
    await expect(page.locator('#resultCount')).toHaveText('14');
    const cvpr = page.locator('.cd-card').filter({ has: page.getByText('CVPR 2027', { exact: true }) });
    await expect(cvpr).toContainText('Nov 10, 2026 · 23:59');
    await expect(cvpr.locator('.js-countdown')).toHaveAttribute('data-deadline', '2026-11-11T11:59:00.000Z');
    const iccv = page.locator('.cd-card').filter({ has: page.getByText('ICCV 2027', { exact: true }) });
    await expect(iccv).toContainText('Dates under review');
    await expect(iccv).toContainText('Deadlines to be announced');
    await expect(iccv.locator('.ics-download-link')).toHaveCount(0);
    await page.locator('#showPastConf').check();
    await expect(page.locator('#resultCount')).toHaveText('26');
    const eccv = page.locator('.cd-card').filter({ has: page.getByText('ECCV 2026', { exact: true }) });
    await eccv.getByRole('button', { name: 'All 3' }).click();
    await expect(eccv.locator('.cd-deadline-list')).toContainText('Mar 5, 2026 · 10:00');
    expect(liveRequests).toBe(0);
});
