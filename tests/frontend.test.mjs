import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function modules(files = ['utils','data','calendar','api'], location = 'https://example.org/') {
    const window = { location: new URL(location) };
    const context = vm.createContext({window, URL, Date, Intl, TextEncoder, console, setInterval, clearInterval});
    for (const file of files) vm.runInContext(readFileSync('assets/js/' + file + '.js','utf8'), context);
    return {CD: window.ConferenceDeadlines, context};
}

test('expiry advances to the next deadline, then closed; local day changes update status', () => {
    const {CD} = modules();
    const item = CD.data.normalizeItem({id:'x',name:'X',areas:{AI:['NLP']},deadlines:[
        {type:'Abstract',due:'2027-01-01T11:59:00Z'},{type:'Paper',due:'2027-01-02T11:59:00Z'}
    ]});
    CD.data.refreshTimeState(item,new Date('2027-01-01T11:59:00Z'));
    assert.equal(item.nextDue.toISOString(),'2027-01-02T11:59:00.000Z');
    CD.data.refreshTimeState(item,new Date('2027-01-02T11:59:00Z'));
    assert.equal(item.status,'closed');
    assert.equal(item.nextDue,null);
    CD.data.refreshTimeState(item,new Date('2026-12-01T00:00:00Z'));
    assert.equal(item.status,'upcoming');
    assert.ok(item.searchText.includes('ai'));
});

test('strict suggestion validation handles malformed legacy values without throwing', () => {
    const {CD} = modules();
    for (const deadlines of [[null],[{}],[{type:'X',due:123}],[{type:'X',due:{}}],null,{},[{type:'X',due:'2027-02-30T11:59:00Z'}]]) {
        assert.ok(CD.validateSuggestion({name:'Test',site_url:'https://example.org',is_edit:false,areas:{},deadlines}));
    }
    assert.equal(CD.validateSuggestion({name:'Test',site_url:'https://example.org',is_edit:false,areas:{},deadlines:[]}), '');
    for (const value of [123,true,{},[],null]) assert.equal(CD.formatDateAOE(value),'N/A');
});

test('categories survive prototype names and legacy suggestions retain unrelated areas', () => {
    const {CD} = modules();
    const areas = JSON.parse('{"constructor":["C"],"toString":["T"],"__proto__":["P"]}');
    assert.ok(CD.validAreas(areas));
    const merged = CD.suggestionAreas({category:'AI',subfields:'CV'},areas);
    assert.deepEqual(JSON.parse(JSON.stringify(merged)),{...areas,AI:['CV']});
    assert.equal(CD.suggestionAreas({areas}).__proto__[0],'P');
});

test('all-day calendar events include the last date across years, single days and leap days', () => {
    const {CD} = modules();
    for (const [start,end,expected] of [['2026-12-30','2027-01-02','20270103'],['2028-02-29',null,'20280301'],['2027-03-10','2027-03-10','20270311']]) {
        const event=CD.calendar.createConferenceEvent({id:'x',name:'X',dates:{conf_start:start,conf_end:end}});
        const ics=CD.calendar.generateICSContent(event);
        assert.ok(ics.includes('DTSTART;VALUE=DATE:'+start.replaceAll('-','')));
        assert.ok(ics.includes('DTEND;VALUE=DATE:'+expected));
        assert.equal(new URL(CD.calendar.generateCalendarLink('google',event)).searchParams.get('dates'),start.replaceAll('-','')+'/'+expected);
        assert.equal(new URL(CD.calendar.generateCalendarLink('outlook',event)).searchParams.get('allday'),'true');
    }
    assert.equal(CD.calendar.createConferenceEvent({dates:{conf_start:'2027-02-30'}}),null);
    assert.equal(CD.calendar.createConferenceEvent({dates:{}}),null);
});

test('timed deadlines retain UTC instant; ICS escapes CR injection and folds UTF-8 lines', () => {
    const {CD} = modules();
    const event=CD.calendar.createDeadlineEvent({id:'x',name:'연구'.repeat(60)}, {type:'Paper\rATTENDEE:bad',due:'2027-01-01T11:59:00Z'},0);
    const ics=CD.calendar.generateICSContent(event);
    assert.ok(ics.includes('DTSTART:20270101T115900Z'));
    assert.ok(!ics.includes('DTEND:'), 'instant deadlines omit DTEND instead of specifying an invalid equal end');
    assert.ok(!ics.includes('\rATTENDEE'));
    for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75);
    assert.equal(CD.fromAoeDateTimeLocalToIso('2027-01-01T23:59'),'2027-01-02T11:59:00.000Z');
});

test('pagination reads beyond API caps and surfaces page failures without partial success', async () => {
    const {CD} = modules();
    let calls=0, last=null;
    const all = [{id:'a'},{id:'b'},{id:'c'},{id:'d'}];
    CD.supabaseClient={from:()=>({select(){return this},order(){return this},limit(){return this},gt(key,id){last=id;return this},
        then(resolve){ calls++; resolve({data:all.filter(x=>last===null||x.id>last).slice(0,2),error:null}); }})};
    const another=modules();
    another.context.window.supabase={};
    another.CD.supabaseClient=CD.supabaseClient;
    const result=await another.CD.api.selectAll('conferences');
    assert.equal(result.data.length,4);
    assert.equal(calls,3);
    calls=0;last=null;
    another.CD.supabaseClient={from:()=>({select(){return this},order(){return this},limit(){return this},gt(){return this},
        then(resolve){calls++;resolve(calls===1?{data:[{id:'a'}]}:{error:{message:'offline'}})}})};
    assert.equal((await another.CD.api.selectAll('conferences')).data,null);
});

test('production never substitutes sample data for a failed live request', async () => {
    const {CD,context}=modules(undefined,'https://alldeadlines.info/?demo=1');
    let fallback=false;
    context.fetch=()=>{fallback=true;throw new Error('sample loaded')};
    CD.api.selectConferencesWithDeadlines=async()=>({error:new Error('offline')});
    await assert.rejects(CD.data.loadData(),/offline/);
    assert.equal(fallback,false);
});


test('existing categories exceeding new submission limits stay visible and are never normalized away', () => {
    const {CD}=modules();
    const areas={AI:['x'.repeat(105)],CS:['HCI']};
    assert.equal(CD.validAreas(areas),false);
    assert.equal(CD.isAreasObject(areas),true);
    assert.deepEqual(CD.data.normalizeItem({id:'large',name:'Large',areas}).areas,areas);
    assert.equal(CD.data.normalizeItem({id:'bad',areas:{AI:null}}).malformedAreas,true);
});
