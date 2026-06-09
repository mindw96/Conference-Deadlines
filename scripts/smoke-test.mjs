import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function read(path) {
    return readFileSync(join(root, path), 'utf8');
}

function walk(dir) {
    const base = join(root, dir);
    const entries = readdirSync(base);
    const files = [];

    for (const entry of entries) {
        const fullPath = join(base, entry);
        const stats = statSync(fullPath);
        if (stats.isDirectory()) {
            files.push(...walk(relative(root, fullPath)));
        } else if (entry.endsWith('.js')) {
            files.push(fullPath);
        }
    }

    return files;
}

function checkSyntax() {
    const jsFiles = walk('assets/js');
    for (const file of jsFiles) {
        const source = readFileSync(file, 'utf8');
        try {
            new Function(source);
        } catch (error) {
            throw new Error(`Syntax check failed for ${relative(root, file)}: ${error.message}`);
        }
    }
}

function checkScriptOrder() {
    const index = read('index.html');
    const expectedIndexScripts = [
        'assets/js/utils.js',
        'assets/js/api.js',
        'assets/js/data.js',
        'assets/js/calendar.js',
        'assets/js/render.js',
        'assets/js/forms.js',
        'assets/js/app.js'
    ];

    let cursor = -1;
    for (const script of expectedIndexScripts) {
        const next = index.indexOf(script);
        assert(next > cursor, `index.html script order is wrong near ${script}`);
        cursor = next;
    }

    const admin = read('admin.html');
    const expectedAdminScripts = [
        'assets/js/utils.js',
        'assets/js/api.js',
        'assets/js/admin.js'
    ];

    cursor = -1;
    for (const script of expectedAdminScripts) {
        const next = admin.indexOf(script);
        assert(next > cursor, `admin.html script order is wrong near ${script}`);
        cursor = next;
    }
}

function checkConferenceData() {
    const conferences = JSON.parse(read('conferences.json'));
    assert(Array.isArray(conferences), 'conferences.json must contain an array');

    for (const conference of conferences) {
        assert(typeof conference.id === 'string' && conference.id, 'conference.id is required');
        assert(typeof conference.name === 'string' && conference.name, `${conference.id} name is required`);
        assert(Array.isArray(conference.deadlines), `${conference.id} deadlines must be an array`);

        for (const deadline of conference.deadlines) {
            assert(typeof deadline.type === 'string' && deadline.type, `${conference.id} deadline.type is required`);
            assert(typeof deadline.due === 'string' && !Number.isNaN(Date.parse(deadline.due)), `${conference.id} deadline.due must be parseable`);
            assert(deadline.due.includes('T11:59:00Z'), `${conference.id} deadline should store 23:59 AOE as 11:59 UTC`);
        }
    }
}

function checkSupabaseSchema() {
    const schema = read('supabase_schema.sql');
    const requiredSnippets = [
        'create table if not exists public.conferences',
        'create table if not exists public.deadlines',
        'create table if not exists public.conference_suggestions',
        'create table if not exists public.admin_users',
        'alter table public.conferences enable row level security',
        'create policy "Visitors can create suggestions"',
        'create or replace function public.is_admin()'
    ];

    for (const snippet of requiredSnippets) {
        assert(schema.includes(snippet), `supabase_schema.sql missing: ${snippet}`);
    }
}

function checkRetiredFiles() {
    assert(!existsSync(join(root, 'test.html')), 'test.html should stay retired; use npm run smoke instead');
}

checkSyntax();
checkScriptOrder();
checkConferenceData();
checkSupabaseSchema();
checkRetiredFiles();

console.log('Smoke checks passed.');
