import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const schema = readFileSync('supabase_schema.sql', 'utf8');
const repair = readFileSync('supabase_repair.sql', 'utf8');
const db = new PGlite();
const admin = '00000000-0000-4000-8000-000000000001';
const visitor = '00000000-0000-4000-8000-000000000002';
const validDeadline = [{ type: 'Paper', due: '2027-01-01T11:59:00Z' }];
const base = { name: 'Test 2027', site_url: 'https://example.org', areas: { AI: ['NLP'], CS: ['HCI'] }, conf_start_date: '2027-03-01', conf_end_date: '2027-03-03' };
const query = (sql, params = []) => db.query(sql, params);

before(async () => {
    await db.exec("create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key, email text); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;");
    await query('insert into auth.users values ($1,$2),($3,$4)', [admin, 'owner@example.test', visitor, 'visitor@example.test']);
    await db.exec(schema);
    await query('insert into public.admin_users(user_id) values($1)', [admin]);
    await query("insert into conferences(id,name,site_url,areas,tags,note,timezone) values('existing','Original','https://example.org',$1,array['keep'],'keep note','UTC')", [JSON.stringify(base.areas)]);
    await query("insert into deadlines(conference_id,deadline_type,due_date) values('existing','Old','2026-01-01T00:00:00Z')");
});
after(() => db.close());

async function asRole(role, fn, uid = admin) {
    await db.exec('begin');
    try {
        await db.exec('set local role ' + role);
        await query("select set_config('request.jwt.claim.sub',$1,true)", [uid]);
        const result = await fn();
        await db.exec('commit');
        return result;
    } catch (error) {
        await db.exec('rollback');
        throw error;
    }
}
async function suggestion(fields = {}) {
    const value = { ...base, is_edit: false, deadlines: validDeadline, ...fields };
    const result = await query("insert into conference_suggestions(name,site_url,areas,category,subfields,is_edit,target_conference_id,deadlines,conf_start_date,conf_end_date) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id",
        [value.name,value.site_url, value.areas == null ? null : JSON.stringify(value.areas),value.category || null,value.subfields || null,value.is_edit,value.target_conference_id || null,JSON.stringify(value.deadlines),value.conf_start_date,value.conf_end_date]);
    return result.rows[0].id;
}
const approve = id => asRole('authenticated', () => query('select approve_suggestion($1)', [id]));
const save = (payload = base, deadlines = validDeadline) => asRole('authenticated', () => query('select save_conference($1,$2,$3)', ['existing', JSON.stringify(payload), JSON.stringify(deadlines)]));
async function snapshot() {
    return (await query("select jsonb_build_object('conferences',(select jsonb_agg(c order by id) from conferences c),'deadlines',(select jsonb_agg(d order by id) from deadlines d),'suggestions',(select jsonb_agg(s order by id) from conference_suggestions s)) as state")).rows[0].state;
}

test('only selected administrators can write or call approval; visitors can submit valid suggestions', async () => {
    await asRole('anon', () => query("insert into conference_suggestions(name,site_url,deadlines) values('Visitor','https://example.org','[]')"));
    const id = await suggestion();
    await assert.rejects(asRole('anon', () => query('select approve_suggestion($1)', [id])), /permission denied/);
    await assert.rejects(asRole('authenticated', () => query('select approve_suggestion($1)', [id]), visitor), /Administrator access required/);
    await assert.rejects(asRole('anon', () => query("insert into conferences(id,name) values('bad','Bad')")), /permission denied/);
    const read = await asRole('anon', () => query('select id from conferences'));
    assert.ok(read.rows.length);
    const hidden = await asRole('authenticated', () => query('select * from conference_suggestions'), visitor);
    assert.equal(hidden.rows.length, 0);
    await query('delete from conference_suggestions where id=$1',[id]);
});

test('database rejects malformed deadlines and oversized input even through direct anonymous inserts', async () => {
    const malformed = [null, {}, [null], [{}], [{ type: 'X', due: 123 }], [{ due: validDeadline[0].due }], [{ type: {}, due: validDeadline[0].due }], [{ type: 'X', due: '2027-02-30T11:59:00Z' }], [{ type: 'X', due: 'infinity' }], Array(65).fill(validDeadline[0])];
    for (const value of malformed) {
        assert.equal((await query('select valid_deadlines($1) as valid', [JSON.stringify(value)])).rows[0].valid, false);
        await assert.rejects(asRole('anon', () => query("insert into conference_suggestions(name,site_url,deadlines) values('Invalid','https://example.org',$1)", [JSON.stringify(value)])), /check constraint|Invalid suggestion payload/);
    }
    assert.equal((await query("select valid_deadlines(null) as valid")).rows[0].valid, false);
    await assert.rejects(asRole('anon', () => query("insert into conference_suggestions(name,site_url,deadlines) values($1,'https://example.org','[]')", ['x'.repeat(301)])), /check constraint|Invalid suggestion payload/);
    await assert.rejects(suggestion({ conf_end_date: '2027-02-28' }), /check constraint|Invalid suggestion payload/);
});

test('normal create, edit, and direct save retain multiple categories and omitted metadata', async () => {
    const id = await suggestion();
    await approve(id);
    assert.equal((await query("select count(*)::int as n from conference_suggestions where id=$1",[id])).rows[0].n, 0);
    assert.deepEqual((await query("select areas from conferences where id='test-2027'")).rows[0].areas, base.areas);
    const legacy = await suggestion({ is_edit: true, target_conference_id: 'existing', areas: null, category: 'AI', subfields: 'CV' });
    await approve(legacy);
    assert.deepEqual((await query("select areas from conferences where id='existing'")).rows[0].areas, { AI: ['CV'], CS: ['HCI'] });
    const areas = JSON.parse('{"constructor":["C"],"toString":["T"],"__proto__":["P"],"CS":["HCI"]}');
    await save({ ...base, areas });
    const row = (await query("select areas,tags,note,timezone from conferences where id='existing'")).rows[0];
    assert.deepEqual(row, { areas, tags: ['keep'], note: 'keep note', timezone: 'UTC' });
    await save(base, []);
    assert.equal((await query("select count(*)::int n from deadlines where conference_id='existing'")).rows[0].n, 0);
    await save();
});

test('failed deadline insertion rolls back new approval, edit approval, and direct edit', async () => {
    await db.exec("create function fail_deadline() returns trigger language plpgsql as $$ begin raise exception 'forced insertion failure'; end $$; create trigger test_failure before insert on deadlines for each row execute function fail_deadline();");
    for (const fields of [{name:'Rollback 2027'}, {is_edit:true,target_conference_id:'existing'}]) {
        const id = await suggestion(fields);
        const before = await snapshot();
        await assert.rejects(approve(id), /forced insertion failure/);
        assert.deepEqual(await snapshot(), before);
        await query('delete from conference_suggestions where id=$1',[id]);
    }
    const before = await snapshot();
    await assert.rejects(save({...base, name:'Must roll back'}), /forced insertion failure/);
    assert.deepEqual(await snapshot(), before);
    await db.exec('drop trigger test_failure on deadlines; drop function fail_deadline()');
});

test('zero-row RLS deletion and cleanup cause full rollback', async () => {
    await db.exec('drop policy "Admins can delete deadlines" on deadlines');
    let before = await snapshot();
    await assert.rejects(save({...base, name:'Blocked delete'}), /Deadline deletion was blocked/);
    assert.deepEqual(await snapshot(), before);
    await db.exec(repair);
    const id = await suggestion({is_edit:true,target_conference_id:'existing'});
    await db.exec('drop policy "Admins can delete suggestions" on conference_suggestions');
    before = await snapshot();
    await assert.rejects(approve(id), /Suggestion cleanup was blocked/);
    assert.deepEqual(await snapshot(), before);
    await db.exec(repair);
    await query('delete from conference_suggestions where id=$1',[id]);
});

test('invalid legacy rows survive repair and stay rejectable; repair never enrolls other Auth users', async () => {
    assert.equal(schema, repair);
    await db.exec('drop trigger suggestions_validate_payload on conference_suggestions');
    const id = await suggestion({deadlines:[null]});
    await db.exec(repair);
    await db.exec(repair);
    assert.equal((await query('select count(*)::int n from admin_users')).rows[0].n, 1);
    const before = await snapshot();
    await assert.rejects(approve(id), /Invalid suggestion/);
    assert.deepEqual(await snapshot(), before);
    await asRole('authenticated', () => query('delete from conference_suggestions where id=$1',[id]));
});

test('duplicate IDs, deleted targets, and repeated approvals retain data safely', async () => {
    const dup = await suggestion();
    let before = await snapshot();
    await assert.rejects(approve(dup), /duplicate key/);
    assert.deepEqual(await snapshot(), before);
    await query('delete from conference_suggestions where id=$1',[dup]);
    await query("insert into conferences(id,name) values('to-delete','Target')");
    const missing = await suggestion({is_edit:true,target_conference_id:'to-delete'});
    await query("delete from conferences where id='to-delete'");
    before = await snapshot();
    await assert.rejects(approve(missing), /Invalid suggestion|Target conference missing/);
    assert.deepEqual(await snapshot(), before);
    await query('delete from conference_suggestions where id=$1',[missing]);
    const id = await suggestion({name:'Once 2027'});
    await approve(id);
    before = await snapshot();
    await assert.rejects(approve(id), /already processed/);
    assert.deepEqual(await snapshot(), before);
});

test('sample seed is additive and repeatable, including existing conference edits', async () => {
    const seed = readFileSync('supabase_migration.sql','utf8');
    await db.exec(seed);
    await query("update conferences set name='Keep edited seed' where id='aaai-2026'");
    const before = await snapshot();
    await db.exec(seed);
    assert.deepEqual(await snapshot(), before);
});


test('a malformed legacy edit remains rejectable after its target is deleted', async () => {
    await query("insert into conferences(id,name) values('legacy-target','Legacy Target')");
    await db.exec('drop trigger suggestions_validate_payload on conference_suggestions');
    const id=await suggestion({is_edit:true,target_conference_id:'legacy-target',deadlines:[null]});
    await db.exec(repair);
    await asRole('authenticated',()=>query("delete from conferences where id='legacy-target'"));
    const row=(await query('select target_conference_id,deadlines from conference_suggestions where id=$1',[id])).rows[0];
    assert.equal(row.target_conference_id,null);
    assert.deepEqual(row.deadlines,[null]);
    await assert.rejects(approve(id),/Invalid suggestion/);
    await asRole('authenticated',()=>query('delete from conference_suggestions where id=$1',[id]));
});


test('upgrade supports dashboard UUID deadline IDs and absent suggestion FK', async () => {
    const legacy = new PGlite();
    try {
        await legacy.exec("create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key,email text); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;");
        await legacy.exec(schema);
        await legacy.exec("alter table deadlines alter column id drop identity; alter table deadlines alter column id type uuid using gen_random_uuid(); alter table deadlines alter column id set default gen_random_uuid(); alter table conference_suggestions drop constraint conference_suggestions_target_conference_id_fkey; alter table conference_suggestions drop column areas; alter table conference_suggestions drop column tags;");
        await legacy.exec(repair);
        await legacy.query('insert into auth.users(id) values($1)',[admin]);
        await legacy.query('insert into admin_users(user_id) values($1)',[admin]);
        await legacy.exec("insert into conferences(id,name) values('uuid-ids','UUID IDs'); begin; set local role authenticated;");
        await legacy.query("select set_config('request.jwt.claim.sub',$1,true)",[admin]);
        await legacy.query("select save_conference('uuid-ids',$1,$2)",[JSON.stringify(base),JSON.stringify(validDeadline)]);
        await legacy.exec('commit');
        assert.equal((await legacy.query("select pg_typeof(id)::text as type from deadlines")).rows[0].type,'uuid');
        assert.equal((await legacy.query("select count(*)::int n from pg_constraint where conrelid='conference_suggestions'::regclass and contype='f'")).rows[0].n,1);
    } finally {await legacy.close();}
});
