const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const source = readFileSync(require.resolve('../site/plugin.js'), 'utf8');

function setup(options = {}) {
    const state = {pages: [], calls: []};
    const hooks = {};
    const testApi = {};
    const doc = {
        currentScript: {src: 'https://example.test/plugin.js'},
        head: {appendChild() {}},
        createElement() { return {}; }
    };
    const raw = JSON.parse(readFileSync(require.resolve('../site/rating.json'), 'utf8'));
    raw.rows = raw.rows.filter((row, index) => index === 0 || row.id !== "1114973");
    raw.rows.forEach((row, index) => { row.rank = index + 1; });
    const candidate = raw.rows[0];
    raw.rows[0] = {...candidate, id: '1114973', magnet: 'magnet:?xt=urn:btih:' + 'a'.repeat(40), category: '/nashi_seriali',
        title: 'Всё ещё женщина [01-04 из 04] (2026) WEB-DLRip 1080p'};
    const clock = Date.parse(raw.fetchedAt) + 1000;
    class FixedDate extends Date { static now() { return clock; } }
    const win = {
        __RUTOR24_TEST__: testApi,
        localStorage: {getItem() { return null; }, setItem() {}}
    };
    function jquery(el) {
        return Object.assign(el, {
            append() {},
            on(name, cb) { this[name] = cb; }
        });
    }
    class Xhr {
        open() {}
        send() { this.status = 200; this.responseText = JSON.stringify(raw); this.onload(); }
    }
    const scheduled = [];
    const runTimeout = options.fakeTime ? (cb, ms) => {
        const timer = {cb, ms, cleared: false};
        scheduled.push(timer);
        return timer;
    } : setTimeout;
    const cancelTimeout = options.fakeTime ? timer => { timer.cleared = true; } : clearTimeout;
    vm.runInNewContext(source, {document: doc, window: win, $: jquery, XMLHttpRequest: Xhr,
        Date: FixedDate, URL, URLSearchParams, setTimeout: runTimeout, clearTimeout: cancelTimeout});
    const lampa = {
        Activity: {active: () => state.pages.at(-1), push: page => state.pages.push(page)},
        Listener: {follow(name, cb) { hooks[name] = cb; }},
        Api: {sources: {tmdb: {
            img(path) { return 'https://example.test' + path; },
            get: options.get || ((_method, _params, ok) => ok({results: []}))
        }}},
        Torrent: {start(...args) { state.calls.push(args); }},
        Component: {add() {}},
        Menu: {addButton() {}}
    };
    testApi.api.register(lampa);
    return {state, hooks, api: testApi.api, home: win.Rutor24Home, lampa, scheduled, raw};
}

test('release versions share one Full identity but each button opens its own release', () => {
    const {state, hooks, home} = setup();
    const card = {id: 94947, media_type: 'tv', name: 'Полярный'};
    const first = {row: {id: '1114839', rank: 6, magnet: 'magnet:?first'}, card};
    const second = {row: {id: '1114845', rank: 16, magnet: 'magnet:?second'}, card};
    for (const entry of [first, second]) {
        home.openEntry(entry);
        const full = state.pages.at(-1);
        assert.equal(full.id, 94947);
        assert.equal(full.method, 'tv');
        let button;
        const buttons = {length: 1, first() { return this; }, find() { return {length: +!!button}; },
            append(el) { button = el; }};
        hooks.full({type: 'complite', object: {...full}, body: {find: () => buttons}});
        assert.equal(button, undefined);
        hooks.full({type: 'complite', object: full, body: {find: () => buttons}});
        button['hover:enter']();
        const release = state.pages.at(-1);
        assert.equal(release.row.magnet, entry.row.magnet);
        assert.equal(release.fromFull, true);
    }
    assert.equal(state.calls.length, 0);
    state.pages.pop();
    home.openEntry({row: {id: '1114973', rank: 9}});
    assert.equal(state.pages.at(-1).row.id, '1114973');
});

test('series type and similar results do not select a homonymous work', () => {
    const {api} = setup();
    const tv = api.describe('Остров сокровищ [S01] (2026) WEB-DL 1080p');
    assert.equal(api.pickMatch([{id: 1, media_type: 'movie', title: 'Остров сокровищ',
        release_date: '2026-01-01'}], tv), null);
    const movie = api.describe('Одно имя (2026) BDRip 1080p');
    assert.equal(api.pickMatch([2025, 2026].map(id => ({id, media_type: 'movie', title: 'Одно имя',
        release_date: id + '-01-01'})), movie), null);
});

test('home retains the release and updates the same card after the render deadline', async () => {
    let resolveSearch;
    const {home, scheduled} = setup({fakeTime: true, get(method, params, ok) {
        assert.equal(method, 'search/tv');
        assert.match(decodeURIComponent(params.query), /Всё ещё женщина/);
        resolveSearch = ok;
    }});
    const pending = home.cards(1, 0);
    await new Promise(resolve => setImmediate(resolve));
    scheduled.find(timer => timer.ms === 2800).cb();
    const [card] = await pending;
    assert.match(card.poster, /^https:\/\/lostpix/);
    const entry = card.rt24Entry;
    assert.equal(entry.card, undefined);
    resolveSearch({results: [{id: 4242, name: 'Всё ещё женщина', original_name: 'Всё ещё женщина',
        first_air_date: '2026-11-17', poster_path: '/correct.jpg'}]});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(card.rt24Entry, entry);
    assert.equal(entry.row.id, '1114973');
    assert.equal(card.poster_path, '/correct.jpg');
    assert.equal(entry.card.id, 4242);
});
