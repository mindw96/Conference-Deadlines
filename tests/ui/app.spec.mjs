import {test,expect} from '@playwright/test';
const instant='2027-01-01T00:00:00Z';
function conference(index=0) {
    return { id:'conf-'+String(index).padStart(3,'0'), name:index===0?'Boundary Conference':'Conference '+index,
        site_url:'https://example.org',location:'Seoul',areas:JSON.parse('{"constructor":["C"],"__proto__":["P"],"AI":["NLP"]}'),
        conf_start_date:'2027-12-30',conf_end_date:'2028-01-02',tags:[],
        deadlines:index===0?[{deadline_type:'Abstract',due_date:'2027-01-01T00:00:02Z'},{deadline_type:'Paper',due_date:'2027-01-01T00:00:04Z'}]:[] };
}
async function fixture(page,{admin=false,fail=false,largeAreas=false,preciseValues=false,badDeadlines=false}={}) {
    const controller={fail,posts:[],rpcs:[],suggestions:[
        {id:'bad',name:'Malformed legacy',is_edit:false,site_url:'https://example.org',deadlines:[null]},
        {id:'number',name:'Numeric due',is_edit:false,site_url:'https://example.org',deadlines:[{type:'X',due:123}]},
        {id:'good',name:'Healthy suggestion',is_edit:false,site_url:'https://example.org',areas:{AI:['NLP']},deadlines:[]}
    ]};
    await page.clock.install({time:new Date(instant)});
    await page.clock.pauseAt(new Date(instant));
    if(admin) await page.addInitScript(()=>{
        const b64=value=>btoa(JSON.stringify(value)).replaceAll('=','').replaceAll('+','-').replaceAll('/','_');
        const user={id:'00000000-0000-4000-8000-000000000001',email:'owner@example.test'};
        localStorage.setItem('sb-tavlqhidtjxgwclhjkje-auth-token',JSON.stringify({access_token:b64({alg:'HS256',typ:'JWT'})+'.'+b64({sub:user.id,exp:2208988800,role:'authenticated'})+'.test',refresh_token:'test-only',expires_at:2208988800,expires_in:99999999,token_type:'bearer',user}));
    });
    await page.route('https://tavlqhidtjxgwclhjkje.supabase.co/**',async route=>{
        const req=route.request(),url=new URL(req.url()),table=url.pathname.split('/').pop();
        const send=(data,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(data)});
        if(controller.fail) return send({message:'Test network failure'},503);
        if(url.pathname.includes('/rpc/')) {controller.rpcs.push({name:table,body:req.postDataJSON()});return send('conf-000');}
        if(req.method()==='POST') {controller.posts.push(req.postDataJSON());return send(null,201);}
        if(req.method()==='DELETE') {
            const id=url.searchParams.get('id')?.slice(3);
            controller.suggestions=controller.suggestions.filter(s=>s.id!==id);
            return send([{id}]);
        }
        let rows=table==='conference_suggestions'?controller.suggestions:Array.from({length:30},(_,i)=>conference(i));
        if (largeAreas && table === 'conferences') rows[0].areas = {AI:['x'.repeat(105)],CS:['HCI']};
        if (preciseValues && table === 'conferences') {
            rows[0].areas = {' AI\nLab ':['Vision\nLanguage, NLP','NLP']};
            rows[0].deadlines = [{deadline_type:'Paper',due_date:'2027-01-01T11:59:59.123456Z'}];
        }
        if (badDeadlines && table === 'conferences') rows[0].deadlines.push({deadline_type:'Legacy',due_date:'infinity'});
        const id=url.searchParams.get('id');
        if(id?.startsWith('gt.')) rows=rows.filter(row=>row.id>id.slice(3));
        if(id?.startsWith('eq.')) return send(rows.find(row=>row.id===id.slice(3)));
        rows=[...rows].sort((a,b)=>a.id.localeCompare(b.id)).slice(0,3);
        return send(rows);
    });
    return controller;
}
test('pagination, prototype categories, debounce and expiry stay usable',async({page})=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await fixture(page);
    await page.goto('/');
    await expect(page).toHaveTitle('Conference Deadlines');
    await expect(page.locator('#resultCount')).toHaveText('30');
    await expect(page.locator('.cd-card')).toHaveCount(24);
    await page.locator('#loadMore').click();
    await expect(page.locator('.cd-card')).toHaveCount(30);
    await page.locator('#categoryFilter').selectOption('constructor');
    await page.locator('#subfieldFilter').selectOption('C');
    await expect(page.locator('#resultCount')).toHaveText('30');
    await page.locator('#q').fill('Boundary');
    await page.clock.runFor(160);
    await expect(page.locator('.cd-card')).toHaveCount(1);
    await page.clock.runFor(2100);
    await expect(page.locator('.cd-card .cd-card-status')).toContainText('Paper');
    await page.clock.runFor(2100);
    await expect(page.locator('.js-countdown')).toHaveCount(0);
    await page.locator('#statusFilter').selectOption('closed');
    await expect(page.locator('#resultCount')).toHaveText('1');
    await expect(page.locator('.cd-deadline-badge')).toHaveClass(/is-closed/);
    expect(errors).toEqual([]);
    await page.screenshot({path:test.info().outputPath('public.png'),fullPage:true});
});

test('name-only edits preserve timestamp precision and commas inside existing subfields',async({page})=>{
    const controller=await fixture(page,{admin:true,preciseValues:true});
    const areas={' AI\nLab ':['Vision\nLanguage, NLP','NLP']};
    const deadlines=[{type:'Paper',due:'2027-01-01T11:59:59.123456Z'}];
    page.on('dialog',dialog=>dialog.accept());
    await page.goto('/');
    const edit=page.getByRole('button',{name:'Suggest an edit for Boundary Conference'});
    await edit.click();
    await page.clock.runFor(500);
    await page.locator('#suggestEditConfName').fill('Name-only correction');
    await page.locator('#suggestEditForm button[type=submit]').click();
    await expect.poll(()=>controller.posts.length).toBe(1);
    expect(controller.posts[0][0].deadlines).toEqual(deadlines);
    expect(controller.posts[0][0].areas).toEqual(areas);
    await page.clock.runFor(500);
    await expect(page.locator('#suggestEditModal')).not.toBeVisible();

    await edit.click();
    await page.clock.runFor(500);
    await page.locator('#suggestEditDeadlinesContainer .deadline-date').fill('2027-01-02T23:59');
    await page.locator('#suggestEditAreasContainer .area-subfields').fill('CV, NLP');
    await page.locator('#suggestEditAreasContainer .area-category').fill('AI');
    await page.locator('#suggestEditForm button[type=submit]').click();
    await expect.poll(()=>controller.posts.length).toBe(2);
    expect(controller.posts[1][0].deadlines).toEqual([{type:'Paper',due:'2027-01-03T11:59:00.000Z'}]);
    expect(controller.posts[1][0].areas).toEqual({AI:['CV','NLP']});

    await page.goto('/admin.html');
    await page.locator('#conference-list [data-id="conf-000"] .edit-btn').click();
    await page.clock.runFor(500);
    await page.locator('#editConfName').fill('Admin name-only correction');
    await page.locator('#editForm button[type=submit]').click();
    await expect.poll(()=>controller.rpcs.length).toBe(1);
    expect(controller.rpcs[0].body.p_deadlines).toEqual(deadlines);
    expect(controller.rpcs[0].body.p_conference.areas).toEqual(areas);
});

test('public edits cannot silently remove malformed existing deadlines',async({page})=>{
    const controller=await fixture(page,{badDeadlines:true});
    const dialogs=[];
    page.on('dialog',dialog=>{dialogs.push(dialog.message());return dialog.accept();});
    await page.goto('/');
    await page.getByRole('button',{name:'Suggest an edit for Boundary Conference'}).click();
    await expect.poll(()=>dialogs.length).toBe(1);
    expect(dialogs[0]).toContain('malformed deadline data');
    await expect(page.locator('#suggestEditModal')).not.toBeVisible();
    expect(controller.posts).toEqual([]);
    await page.getByRole('button',{name:'Suggest an edit for Conference 1',exact:true}).click();
    await page.clock.runFor(500);
    await expect(page.locator('#suggestEditModal')).toBeVisible();
});
test('edit suggestions keep all categories; partial deadlines cannot be silently dropped',async({page})=>{
    const controller=await fixture(page);
    await page.goto('/');
    await page.locator('.cd-card').filter({hasText:'Boundary Conference'}).getByRole('button',{name:'Suggest an edit for Boundary Conference'}).click();
    await page.clock.runFor(500);
    await expect(page.locator('#suggestEditAreasContainer .area-group')).toHaveCount(3);
    await page.locator('#suggestEditConfName').fill('Corrected name');
    page.on('dialog',dialog=>dialog.accept());
    await page.locator('#suggestEditForm button[type=submit]').click();
    await expect.poll(()=>controller.posts.length).toBe(1);
    await page.clock.runFor(500);
    expect(controller.posts[0][0].areas).toEqual(JSON.parse('{"constructor":["C"],"__proto__":["P"],"AI":["NLP"]}'));
    await expect(page.locator('#suggestEditModal')).not.toBeVisible();
    await page.locator('.cd-card').filter({hasText:'Boundary Conference'}).getByRole('button',{name:'Suggest an edit for Boundary Conference'}).click();
    await page.clock.runFor(500);
    await page.locator('#suggestEditDeadlinesContainer .deadline-date').first().fill('');
    await page.locator('#suggestEditForm button[type=submit]').click();
    await expect(page.locator('#suggestEditForm button[type=submit]')).toBeEnabled();
    expect(controller.posts.length).toBe(1);
});
test('failed live reads show a retry and never fall back to bundled examples',async({page})=>{
    const controller=await fixture(page,{fail:true});
    await page.clock.resume();
    let samples=0;await page.route('**/conferences.json',route=>{samples++;route.abort();});
    await page.goto('/');
    await expect(page.locator('#dataStatus')).toContainText('unavailable', {timeout:15000});
    await expect(page.locator('#retryLoad')).toBeVisible();
    expect(samples).toBe(0);
    controller.fail=false;
    await page.locator('#retryLoad').click();
    await expect(page.locator('#resultCount')).toHaveText('30');
});
test('legacy invalid suggestions remain rejectable and healthy suggestions use atomic RPC',async({page})=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const controller=await fixture(page,{admin:true});
    await page.goto('/admin.html');
    await expect(page.locator('#admin-view')).toBeVisible();
    await expect(page.locator('#conference-list .card')).toHaveCount(30);
    for (const id of ['bad','number']) await expect(page.locator('#suggestions-list [data-id="'+id+'"] .approve-btn')).toBeDisabled();
    await page.locator('#suggestions-list [data-id="bad"] .reject-btn').click();
    await expect(page.locator('#suggestions-list [data-id="bad"]')).toHaveCount(0);
    await page.locator('#suggestions-list [data-id="good"] .approve-btn').click();
    await expect.poll(()=>controller.rpcs.length).toBe(1);
    expect(controller.rpcs[0]).toEqual({name:'approve_suggestion',body:{p_suggestion_id:'good'}});
    await page.locator('#conference-list .edit-btn').first().click();
    await page.clock.runFor(500);
    await expect(page.locator('#editAreasContainer .area-group')).toHaveCount(3);
    await page.locator('#editConfName').fill('Updated name');
    await page.locator('#editForm button[type=submit]').click();
    await expect.poll(()=>controller.rpcs.length).toBe(2);
    expect(controller.rpcs[1].name).toBe('save_conference');
    expect(Object.keys(controller.rpcs[1].body.p_conference.areas)).toEqual(['constructor','__proto__','AI']);
    expect(errors).toEqual([]);
    await page.clock.runFor(500);
    await expect(page.locator('#editModal')).not.toBeVisible();
    await page.screenshot({path:test.info().outputPath('admin.png'),fullPage:false});
});


test('oversized existing categories are retained in both edit forms and cannot be silently cleared',async({page})=>{
    const controller=await fixture(page,{admin:true,largeAreas:true});
    await page.goto('/');
    await expect(page.locator('.cd-card')).toHaveCount(24);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.locator('.cd-card').filter({hasText:'Boundary Conference'}).getByRole('button',{name:'Suggest an edit for Boundary Conference'}).click();
    await page.clock.runFor(500);
    await expect(page.locator('#suggestEditAreasContainer .area-group')).toHaveCount(2);
    await expect(page.locator('#suggestEditAreasContainer .area-subfields').first()).toHaveValue('x'.repeat(105));
    page.on('dialog',dialog=>dialog.accept());
    await page.locator('#suggestEditConfName').fill('Name-only correction');
    await page.locator('#suggestEditForm button[type=submit]').click();
    await expect(page.locator('#suggestEditForm button[type=submit]')).toBeEnabled();
    expect(controller.posts).toEqual([]);
    await page.goto('/admin.html');
    await page.locator('#conference-list .edit-btn').first().click();
    await page.clock.runFor(500);
    await expect(page.locator('#editAreasContainer .area-group')).toHaveCount(2);
    await expect(page.locator('#editAreasContainer .area-subfields').first()).toHaveValue('x'.repeat(105));
    await page.locator('#editForm button[type=submit]').click();
    await expect(page.locator('#editForm button[type=submit]')).toBeEnabled();
    expect(controller.rpcs).toEqual([]);
});
