/* Персональная главная Lampa v1.3.1 cloud */
(function () {
    'use strict';
    var KEY = 'rt24_home';
    var RUTOR = 'Rutor · Топ 24 часа';
    var RU = 'Русское';
    var russian;
    var prefix = 'discover/';
    var country = '?with_origin_country=RU&include_adult=false';
    var installed = false;
    var diagnostic = {api: 0, channels: 0, rutor: '—', ru: '—', recovery: 0, fallback: 0};

    function register(L) {
        if (installed || window.__rt24Home || !L.ContentRows || !L.ContentRows.add) return;
        installed = window.__rt24Home = true;
        function setting(name, fallback) {
            return L.Storage.field(KEY + '_' + name) ?? fallback;
        }
        function enabled(value) {
            return ![false, 'false', '0', 0].includes(value);
        }
        function kinds() {
            var storage = L.Storage;
            if (storage.get && !enabled(storage.get('content_rows_' + KEY, true))) return [];
            var order = setting('order', 'rutor') === 'ru' ? ['ru', 'rutor'] : ['rutor', 'ru'];
            return order.filter(function (kind) { return enabled(setting(kind, true)); });
        }
        function isMain(params) {
            return params && params.component === 'main' && !params.genres && !params.keywords;
        }
        function limit() {
            return Math.max(6, Math.min(18, Number(setting('limit', 12)) || 12));
        }
        function age() {
            return (Number(setting('minutes', 15)) || 15) * 60000;
        }
        function bounded(promise, ms, fallback) {
            return new Promise(function (resolve) {
                var timer = setTimeout(function () { resolve(fallback); }, ms);
                Promise.resolve(promise).then(function (value) {
                    clearTimeout(timer);
                    resolve(value);
                }, function () {
                    clearTimeout(timer);
                    resolve(fallback);
                });
            });
        }
        function discover(type, recent) {
            var today = new Date();
            var since = new Date(today.getTime() - 120 * 86400000);
            var date = type === 'movie' ? 'primary_release_date' : 'first_air_date';
            var path = prefix + type + country + '&sort_by=popularity.desc';
            if (recent) path += '&' + date + '.gte=' + since.toISOString().slice(0, 10) +
                '&' + date + '.lte=' + today.toISOString().slice(0, 10);
            return path;
        }
        function russianCards() {
            if (russian && Date.now() < russian.until) return russian.promise;
            var previous = russian && russian.cards;
            var entry = {until: Date.now() + age()};
            russian = entry;
            var tmdb = L.Api.sources.tmdb;
            function query(type, recent) {
                return bounded(new Promise(function (resolve, reject) {
                    tmdb.get(discover(type, recent), {}, function (json) {
                        resolve((json.results || []).filter(function (card) {
                            return card.id && !card.adult && card.poster_path &&
                                (type !== 'tv' || (card.origin_country || []).includes('RU'));
                        }).map(function (card) {
                            return Object.assign({}, card, {source: 'tmdb', media_type: type});
                        }));
                    }, reject);
                }), 7500, []);
            }
            entry.promise = Promise.all([query('movie', true), query('tv', true), query('movie', false), query('tv', false)])
                .then(function (groups) {
                    var seen = new Set();
                    var cards = [];
                    for (var i = 0; i < 20; i++) groups.forEach(function (group) {
                        var card = group[i];
                        if (!card) return;
                        var id = card.media_type + ':' + card.id;
                        if (seen.has(id)) return;
                        seen.add(id);
                        cards.push(card);
                    });
                    entry.cards = cards.length ? cards : previous || [];
                    if (!cards.length) entry.until = Date.now() + 60000;
                    return entry.cards;
                });
            return entry.promise;
        }
        function openRussian() {
            function back() {
                L.Controller.toggle('items_line', true);
            }
            L.Select.show({
                title: 'Русское',
                items: [
                    {title: 'Российские фильмы', type: 'movie'},
                    {title: 'Российские сериалы', type: 'tv'}
                ],
                onBack: back,
                onSelect: function (item) {
                    L.Router.call('category_full', {title: item.title, url: discover(item.type, false), source: 'tmdb'});
                }
            });
        }
        function result(kind, title, cards) {
            return {rt24Home: kind, title: title, source: 'tmdb', total_pages: 2, results: cards};
        }
        function unavailable(kind) {
            return result(kind, kind === 'rutor' ? RUTOR : RU, [
                {title: 'Данные недоступны · открыть каталог', rt24Status: true}
            ]);
        }
        function waitForRutor() {
            var attempts = 20;
            return new Promise(function (resolve) {
                function check() {
                    if (window.Rutor24Home || !attempts--) resolve(window.Rutor24Home);
                    else setTimeout(check, 100);
                }
                check();
            });
        }
        function load(kind) {
            return function (done) {
                function finish(row) {
                    diagnostic[kind] = row.results[0].rt24Status ? 'нет данных' : row.results.length + ' карточек';
                    done(row);
                }
                if (kind === 'ru') {
                    bounded(Promise.resolve().then(russianCards).then(function (cards) {
                        return cards.length ? result(kind, RU, cards.slice(0, limit())) : unavailable(kind);
                    }), 8000, unavailable(kind)).then(finish);
                    return;
                }
                var work = waitForRutor().then(function (api) {
                    if (!api) return unavailable('rutor');
                    return api.cards(limit(), age()).then(function (cards) {
                        if (!cards.length) return unavailable('rutor');
                        var status = api.status ? api.status() : {};
                        var timeFormat = {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'};
                        var when = status.checkedAt ? ' · проверено ' + new Date(status.checkedAt).toLocaleString('ru-RU', timeFormat) : '';
                        if (status.stale && status.at) {
                            when += ' · снимок ' + new Date(status.at).toLocaleString('ru-RU', timeFormat);
                        }
                        return result(kind, RUTOR + when, cards);
                    });
                });
                bounded(work, 11800, unavailable('rutor')).then(finish);
            };
        }
        var style = document.createElement('style');
        style.textContent = '.rt24-home-heading.focus{outline:.12em solid currentColor;outline-offset:.2em;border-radius:.15em}';
        document.head.appendChild(style);
        var loaders = {rutor: load('rutor'), ru: load('ru')};
        L.ContentRows.add({
            name: KEY,
            title: 'Персональная главная',
            screen: 'main',
            index: 1,
            call: function () {
                diagnostic.channels++;
                return kinds().map(function (kind) { return loaders[kind]; });
            }
        });
        // Some Lampa sources return the native main batch without invoking ContentRows.
        // Fill only the missing rows and leave the native pagination function intact.
        var nativeMain = L.Api.main;
        L.Api.main = function (params, complete, empty) {
            if (!isMain(params) || typeof complete !== 'function' || !kinds().length) {
                return nativeMain.apply(this, arguments);
            }
            diagnostic.api++;
            function merge(batch, context) {
                var order = kinds();
                var native = [], present = {};
                (batch || []).forEach(function (row) {
                    if (row && (row.rt24Home === 'rutor' || row.rt24Home === 'ru')) {
                        if (!present[row.rt24Home]) present[row.rt24Home] = row;
                    } else native.push(row);
                });
                var missing = order.filter(function (kind) { return !present[kind]; });
                if (missing.length) diagnostic.fallback++;
                function deliver() {
                    var label = L.Lang && L.Lang.translate('title_now_watch');
                    var first = native.findIndex(function (row) {
                        return row && (row.title === label || row.title === 'Сейчас смотрят');
                    });
                    var where = first >= 0 ? first + 1 : Math.min(1, native.length);
                    native.splice.apply(native, [where, 0].concat(order.map(function (kind) { return present[kind]; })));
                    complete.call(context, native);
                }
                if (!missing.length) return deliver();
                Promise.all(missing.map(function (kind) {
                    return new Promise(loaders[kind]).then(function (row) { present[kind] = row; });
                })).then(deliver);
            }
            return nativeMain.call(this, params, function (batch) {
                merge(batch, this);
            }, function () {
                if (kinds().length) merge([], this);
                else if (typeof empty === 'function') empty.apply(this, arguments);
            });
        };
        var openedFromRussian = new WeakSet();
        if (L.Activity.listener) L.Activity.listener.follow('backward', function () {
            var current = L.Activity.active();
            if (current && openedFromRussian.has(current) && current.activity) {
                current.activity.is_started = false;
                openedFromRussian.delete(current);
            }
        });

        function customize(line, data) {
            if (!data || !data.rt24Home) return;
            if (!line || !line.use) return;
            var isRutor = data.rt24Home === 'rutor';
            function more() {
                if (isRutor) {
                    if (window.Rutor24Home) window.Rutor24Home.openCatalog();
                } else openRussian();
            }
            var heading = line.render(true).querySelector('.items-line__title');
            if (heading) {
                heading.classList.add('selector', 'rt24-home-heading');
                heading.addEventListener('hover:enter', more);
            }
            line.use({
                onlyMore: more,
                onToggle: function () {
                    if (heading) L.Controller.collectionAppend(heading);
                },
                onController: function (controller) {
                    var up = controller.up;
                    controller.up = function () {
                        if (heading && window.Navigator.getFocusedElement() !== heading) {
                            window.Navigator.focus(heading);
                        } else up();
                    };
                    var down = controller.down;
                    controller.down = function () {
                        if (heading && window.Navigator.getFocusedElement() === heading) {
                            L.Controller.collectionFocus(line.last || false, line.scroll.render(true));
                        } else down();
                    };
                },
                onInstance: function (card, data) {
                    if (data.rt24Status) {
                        card.use({onlyEnter: more});
                        return;
                    }
                    if (isRutor && !data.rt24Entry) return;
                    if (!isRutor) card.use({
                        onCreate: function () {
                            var image = this.render(true).querySelector('.card__img');
                            if (!image) return;
                            image.onerror = function () {
                                image.onerror = null;
                                clearTimeout(this.img_timer);
                                image.src = './img/img_broken.svg';
                            }.bind(this);
                        }
                    });
                    if (!isRutor) {
                        card.use({onlyEnter: function () {
                            var previous = L.Activity.active();
                            if (!previous || previous.component !== 'main') return;
                            L.Router.call('full', data);
                            var current = L.Activity.active();
                            if (current && current !== previous && current.component === 'full') {
                                openedFromRussian.add(current);
                            }
                        }});
                        return;
                    }
                    var api = window.Rutor24Home;
                    if (api && api.bindCard) api.bindCard(card, data.rt24Entry);
                    card.use({
                        onlyEnter: function () {
                            var api = window.Rutor24Home;
                            var current = L.Activity.active();
                            if (api && current && current.component === 'main') (api.openEntry || api.openRelease)(data.rt24Entry);
                        },
                        onCreate: function () {
                            var view = this.render(true).querySelector('.card__view');
                            if (!view) return;
                            var mark = document.createElement('span');
                            mark.className = 'rt24-rank';
                            mark.textContent = '№ ' + data.rt24Entry.row.rank;
                            view.appendChild(mark);
                        }
                    });
                }
            });
        }
        var attached = new WeakSet();
        var repairing = new WeakSet();
        var recovered = new WeakSet();
        var replacing = false;
        function recover(page) {
            if (replacing || !isMain(page) || !page.activity || attached.has(page.activity) ||
                repairing.has(page.activity) || recovered.has(page.activity) ||
                !kinds().length || typeof L.Activity.replace !== 'function') return;
            var slide = page.activity;
            repairing.add(slide);
            Promise.resolve().then(function () {
                // A quick navigation away cancels this attempt. Back can try again.
                repairing.delete(slide);
                if (L.Activity.active() !== page || page.activity !== slide || attached.has(slide)) return;
                recovered.add(slide);
                diagnostic.recovery++;
                replacing = true;
                try {
                    L.Activity.replace();
                    var active = L.Activity.active();
                    if (isMain(active) && active.activity) recovered.add(active.activity);
                } finally {
                    replacing = false;
                }
            });
        }
        L.Listener.follow('activity', function (event) {
            if (!isMain(event.object) || !event.object.activity) return;
            var slide = event.object.activity;
            if (event.type === 'init' && slide.component && slide.component.use) {
                attached.add(slide);
                slide.component.use({onInstance: customize});
            } else if (event.type === 'start') recover(event.object);
        });
        if (L.Activity.active) recover(L.Activity.active());
        if (!L.SettingsApi) return;
        L.SettingsApi.addComponent({component: KEY, name: 'Персональная главная',
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 10l9-7 9 7v11H3z"/></svg>'});
        function param(name, title, values, initial) {
            L.SettingsApi.addParam({
                component: KEY,
                param: {name: KEY + '_' + name, type: values ? 'select' : 'trigger', values: values, default: initial},
                field: {name: title, description: 'Применяется при следующем открытии главной.'}
            });
        }
        param('rutor', RUTOR, null, true);
        param('ru', RU, null, true);
        param('order', 'Порядок дополнительных рядов', {rutor: 'Сначала Rutor', ru: 'Сначала Русское'}, 'rutor');
        param('limit', 'Карточек в ряду', {6: '6', 8: '8', 12: '12', 18: '18'}, '12');
        param('minutes', 'Обновление при открытии главной', {5: '5 минут', 15: '15 минут', 30: '30 минут', 60: '1 час'}, '15');
        L.SettingsApi.addParam({
            component: KEY,
            param: {name: KEY + '_diagnostic', type: 'button'},
            field: {name: 'Диагностика главной (1.2.0)'},
            onChange: function () {
                var info = 'Главная ' + diagnostic.api + ' · каналы ' + diagnostic.channels +
                    ' · дополнено ' + diagnostic.fallback + ' · перезапуск ' + diagnostic.recovery +
                    ' · Rutor ' + diagnostic.rutor + ' · Русское ' + diagnostic.ru;
                if (L.Noty && L.Noty.show) L.Noty.show(info);
                console.info('[Rutor24 Home]', info);
            }
        });
    }

    function ready() {
        var L = window.Lampa;
        if (!L || !L.Listener || !L.ContentRows || !L.ContentRows.add ||
            !L.Api || typeof L.Api.main !== 'function' || !L.Activity || !L.Storage) return false;
        register(L);
        return true;
    }
    if (!ready()) {
        var attempts = 0;
        var wait = setInterval(function () {
            if (ready() || ++attempts === 40) clearInterval(wait);
        }, 250);
    }
})();
