import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { generateConferenceImport } from '../scripts/generate-conference-import.mjs';

const manifest = JSON.parse(readFileSync('data/ai-conferences.json', 'utf8'));
const sql = generateConferenceImport(manifest);

async function database(uuid = false) {
    const db = new PGlite();
    await db.exec("create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;");
    await db.exec(readFileSync('supabase_schema.sql', 'utf8'));
    if (uuid) await db.exec('alter table deadlines alter column id drop identity; alter table deadlines alter column id type uuid using gen_random_uuid(); alter table deadlines alter column id set default gen_random_uuid();');
    return db;
}

async function snapshot(db) {
    return (await db.query("select jsonb_build_object('conferences',(select jsonb_agg(c order by id) from conferences c),'deadlines',(select jsonb_agg(d order by id) from deadlines d),'suggestions',(select jsonb_agg(s order by id) from conference_suggestions s),'admins',(select jsonb_agg(a order by user_id) from admin_users a)) as state")).rows[0].state;
}

test('checked-in conference import matches its manifest generator', () => {
    assert.equal(readFileSync('supabase_ai_conferences.sql', 'utf8'), sql);
});

for (const uuid of [false, true]) test(`import is additive and repeatable with ${uuid ? 'UUID' : 'identity'} deadline IDs`, async () => {
    const db = await database(uuid);
    try {
        const c = manifest.conferences[0];
        await db.query("insert into conferences(id,name,site_url,areas,tags,note) values('legacy-id',$1,'https://kept.example','{\"Existing\":[\"Keep\"]}',array['keep'],'keep note')", ['  ' + c.name.toUpperCase().replaceAll(' ', '   ') + '  ']);
        await db.query("insert into deadlines(conference_id,deadline_type,due_date) values('legacy-id','Existing label',$1),('legacy-id','Unrelated deadline','2000-01-01T00:00:00Z')", [c.deadlines[0].due]);
        await db.exec("insert into auth.users values('00000000-0000-4000-8000-000000000001'); insert into admin_users(user_id) select id from auth.users; insert into conference_suggestions(name,site_url,is_edit,target_conference_id) values('Pending correction','https://example.org',true,'legacy-id');");
        const before = await snapshot(db);
        await db.exec(sql);
        const after = await snapshot(db);
        assert.equal(after.conferences.length, manifest.conferences.length);
        assert.deepEqual(after.conferences.find(row => row.id === 'legacy-id'), before.conferences[0]);
        assert.equal(after.conferences.some(row => row.id === c.id), false);
        for (const deadline of before.deadlines) assert.deepEqual(after.deadlines.find(row => row.id === deadline.id), deadline);
        assert.equal(after.deadlines.filter(row => row.conference_id === 'legacy-id').length, c.deadlines.length + 1);
        assert.deepEqual(after.suggestions, before.suggestions);
        assert.deepEqual(after.admins, before.admins);
        const eccv = await db.query("select to_char(due_date at time zone 'UTC','HH24:MI') as time from deadlines where conference_id='eccv-2026'");
        assert.deepEqual(eccv.rows.map(row => row.time), ['22:00', '22:00', '22:00']);
        await db.exec(sql);
        assert.deepEqual(await snapshot(db), after);
    } finally { await db.close(); }
});

test('conflicting IDs or multiple name matches roll back the entire import', async () => {
    const db = await database();
    try {
        const conflict = manifest.conferences.at(-1);
        for (const mode of ['wrong-name', 'ambiguous-name']) {
            await db.exec('truncate conferences cascade');
            if (mode === 'wrong-name') await db.query('insert into conferences(id,name) values($1,$2)', [conflict.id, 'Another conference']);
            else await db.query("insert into conferences(id,name) values('legacy-one',$1),('legacy-two',$1)", [conflict.name]);
            const before = await snapshot(db);
            await assert.rejects(db.exec(sql), /Conference ID belongs to another name|Ambiguous conference identity/);
            await db.exec('rollback');
            assert.deepEqual(await snapshot(db), before);
        }
    } finally { await db.close(); }
});

test('SQL quoting preserves apostrophes and dollar delimiters as data', async () => {
    const db = await database();
    try {
        const c = { ...manifest.conferences[0], note: "Researcher's $conference_data$ and $conference_import$ notes" };
        await db.exec(generateConferenceImport({ conferences: [c] }));
        assert.equal((await db.query('select note from conferences')).rows[0].note, c.note);
    } finally { await db.close(); }
});
