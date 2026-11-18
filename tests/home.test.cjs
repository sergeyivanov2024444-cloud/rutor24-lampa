const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');
const home = readFileSync(process.env.RUTOR_HOME_TEST_FILE || 'site/home.js', 'utf8');

function harness({ channels = true, ready = false, outage = false, disabled = false, oldPage = false, rankStatus = { stale: false } } = {}) {
    const now = { title: 'Сейчас смотрят' };
    const stock = { title: 'Другая штатная подборка' };
    const registry = [];
    const events = {};
    const next = () => {};
    function page() {
        const modules = [];
        return { component: 'main', activity: { component: { use: m => modules.push(m) }, modules } };
    }
    const prior = oldPage ? page() : undefined;
    let current = prior;
    let replaces = 0, tmdb = 0, rutor = 0;
    function event(type, object) {
        (events.activity || []).forEach(fn => fn({ type, component: object.component, object }));
    }
    function load(params = current || page()) {
        return new Promise(resolve => {
            assert.equal(L.Api.main(params, resolve, () => resolve([])), next);
        });
    }
    const L = {
        Activity: {
            active: () => current,
            replace() {
                replaces++;
                current = page();
                event('init', current);
                event('start', current);
            }
        },
        Storage: {
            field: name => name === 'rt24_home_limit' ? '12' : undefined,
            get: (_, def) => disabled ? 'false' : def
        },
        ContentRows: { add: row => registry.push(row) },
        Listener: { follow: (key, fn) => (events[key] ||= []).push(fn) },
        Lang: { translate: () => now.title },
        Api: {
            main(params, done) {
                const callbacks = [];
                if (channels && !disabled) {
                    for (const row of registry) callbacks.splice(row.index, 0, ...row.call(params, 'main'));
                }
                if (!callbacks.length) done([now, stock]);
                else Promise.all(callbacks.map(loader => new Promise(loader))).then(rows => {
                    // Simulate the same native batch and a duplicate produced by a second extension.
                    done([now, rows[0], rows[0], ...rows.slice(1), stock]);
                });
                return next;
            },
            sources: { tmdb: { get: (_, __, ok, fail) => {
                tmdb++;
                if (outage) fail();
                else ok({ results: [{ id: 12, title: 'Тест TMDB', poster_path: '/a.png', origin_country: ['RU'] }] });
            } } }
        },
        SettingsApi: { addComponent() {}, addParam() {} }
    };
    const window = { Lampa: L, appready: ready, Rutor24Home: {
        async cards(limit) {
            rutor++;
            assert.equal(limit, 12);
            if (outage) throw Error('offline');
            return [{ title: 'Раздача', rt24Entry: { row: { rank: 1, id: '7' } } }];
        },
        status: () => rankStatus
    }};
    const env = vm.createContext({ window, setTimeout, clearTimeout,
        document: { createElement: () => ({}), head: { appendChild() {} } } });
    function install() { vm.runInContext(home, env); }
    return { L, now, stock, registry, prior, install, event, load,
        active: () => current, show: object => { current = object; event('start', object); },
        metrics: () => ({ replaces, tmdb, rutor }) };
}

const titles = rows => Array.from(rows, x => x.title).join('|');
const expected = 'Сейчас смотрят|Rutor · Топ 24 часа|Русское|Другая штатная подборка';

test('registers before app ready; native batch keeps order and removes duplicate rows', async () => {
    const h = harness();
    h.install();
    h.install();
    assert.equal(h.registry.length, 1);
    assert.equal(titles(await h.load()), expected);
    assert.equal(h.metrics().rutor, 1);
});

test('fills missing rows when the source skips ContentRows, and reuses data on reentry', async () => {
    const h = harness({ channels: false, ready: true });
    h.install();
    assert.equal(titles(await h.load()), expected);
    assert.equal(titles(await h.load()), expected);
    assert.equal(h.metrics().tmdb, 4);
});

test('rebuilds a pre-existing home exactly once and leaves its new slide intact on Back', async () => {
    const h = harness({ ready: true, oldPage: true });
    h.install();
    await Promise.resolve();
    const fixed = h.active();
    assert.notEqual(fixed, h.prior);
    assert.equal(fixed.activity.modules.length, 1);
    h.show({ component: 'full' });
    h.show(fixed);
    await Promise.resolve();
    assert.equal(h.metrics().replaces, 1);
    assert.equal(fixed.activity.modules.length, 1);
    assert.equal(titles(await h.load()), expected);
});

test('a failed Rutor request and TMDB outage leave two usable row entries', async () => {
    const h = harness({ channels: false, outage: true });
    h.install();
    const rows = await h.load();
    assert.equal(titles(rows), expected);
    assert.equal(rows[1].results[0].rt24Status, true);
    assert.equal(rows[2].results[0].rt24Status, true);
});

test('respects the Channels toggle and leaves a non-main screen alone', async () => {
    const h = harness({ channels: false, disabled: true, oldPage: true });
    h.install();
    assert.equal(titles(await h.load()), 'Сейчас смотрят|Другая штатная подборка');
    assert.deepEqual(h.metrics(), { replaces: 0, tmdb: 0, rutor: 0 });
    const other = harness({ channels: false });
    other.install();
    assert.equal(titles(await other.load({ component: 'category' })), 'Сейчас смотрят|Другая штатная подборка');
});


test('shows the cloud check time separately from the age of the ranking', async () => {
    const date = Date.UTC(2026, 10, 18, 14, 4);
    const checked = date + 3720000;
    const format = {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'};
    const h = harness({rankStatus: {stale: true, at: date, checkedAt: checked}});
    h.install();
    const rows = await h.load();
    assert.equal(rows[1].title, 'Rutor · Топ 24 часа · проверено ' +
        new Date(checked).toLocaleString('ru-RU', format) + ' · снимок ' +
        new Date(date).toLocaleString('ru-RU', format));
});
