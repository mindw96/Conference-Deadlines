import { test, expect } from '@playwright/test';

async function reviewFixture(page, suggestions, conferences = []) {
    const actions = [];
    await page.addInitScript(() => {
        const b64 = value => btoa(JSON.stringify(value)).replaceAll('=', '').replaceAll('+', '-').replaceAll('/', '_');
        const user = { id: '00000000-0000-4000-8000-000000000001', email: 'owner@example.test' };
        localStorage.setItem('sb-tavlqhidtjxgwclhjkje-auth-token', JSON.stringify({
            access_token: b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub: user.id, exp: 2208988800, role: 'authenticated' }) + '.test',
            refresh_token: 'test-only', expires_at: 2208988800, expires_in: 99999999, token_type: 'bearer', user
        }));
    });
    await page.route('https://tavlqhidtjxgwclhjkje.supabase.co/**', async route => {
        const request = route.request(), url = new URL(request.url());
        const table = url.pathname.split('/').pop();
        let result;
        if (request.method() === 'DELETE') {
            const id = url.searchParams.get('id').slice(3);
            suggestions = suggestions.filter(s => s.id !== id);
            actions.push({ action: 'reject', id });
            result = [{ id }];
        } else if (url.pathname.includes('/rpc/')) {
            actions.push({ action: table, ...request.postDataJSON() });
            result = 'legacy';
        } else {
            result = table === 'conference_suggestions' ? suggestions : conferences;
            const cursor = url.searchParams.get('id');
            if (cursor?.startsWith('gt.')) result = result.filter(row => row.id > cursor.slice(3));
            result = [...result].sort((a, b) => a.id.localeCompare(b.id));
        }
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(result) });
    });
    return actions;
}

const suggestion = { id: 'a-edit', name: 'Legacy conference', site_url: 'https://example.org', areas: {}, deadlines: [], is_edit: true, target_conference_id: 'legacy' };

test('an invalid existing deadline does not break the review queue', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const actions = await reviewFixture(page, [suggestion, { ...suggestion, id: 'b-new', is_edit: false }], [
        { id: 'legacy', name: suggestion.name, site_url: suggestion.site_url, areas: {}, deadlines: [{ deadline_type: 'Paper', due_date: 'infinity' }] }
    ]);
    await page.goto('/admin.html');
    const edit = page.locator('#suggestions-list [data-id="a-edit"]');
    await expect(edit).toContainText('Deadlines: List has been updated.');
    await expect(edit.locator('.approve-btn')).toBeEnabled();
    await page.locator('#suggestions-list [data-id="b-new"] .reject-btn').click();
    await expect(page.locator('#suggestions-list [data-id="b-new"]')).toHaveCount(0);
    await edit.locator('.approve-btn').click();
    await expect.poll(() => actions).toEqual([
        { action: 'reject', id: 'b-new' }, { action: 'approve_suggestion', p_suggestion_id: 'a-edit' }
    ]);
    expect(errors).toEqual([]);
});

test('new suggestion metadata is visible and escaped before approval', async ({ page }) => {
    const tags = ['Unreviewed tag', '<img src=x onerror=alert(1)>'];
    const note = '<script>alert(1)</script> Reviewer note';
    await reviewFixture(page, [
        { ...suggestion, id: 'a-new', is_edit: false, tags, note },
        { ...suggestion, id: 'b-edit', tags, note }
    ], [{ id: 'legacy', name: suggestion.name, site_url: suggestion.site_url, areas: {}, deadlines: [] }]);
    await page.goto('/admin.html');
    const card = page.locator('#suggestions-list [data-id="a-new"]');
    await expect(card).toContainText('Tags: ' + tags.join(', '));
    await expect(card).toContainText('Note: ' + note);
    await expect(card.locator('img, script')).toHaveCount(0);
    await expect(page.locator('#suggestions-list [data-id="b-edit"]')).not.toContainText('Reviewer note');
});
