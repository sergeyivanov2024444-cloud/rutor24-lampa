/* Персональная главная Lampa v1.1.0 cloud */
(function () {
    'use strict';
    var KEY = 'rt24_home';
    var RUTOR = 'Rutor · Топ 24 часа';
    var RU = 'Русское';
    var russian;
    var prefix = 'discover/';
    var country = '?with_origin_country=RU&include_adult=false';
    var installed = false;

    function register(L) {
        if (installed || window.__rt24Home || !L.ContentRows || !L.ContentRows.add) return;
        installed = window.__rt24Home = true;
        function setting(name, fallback) {
            return L.Storage.field(KEY + '_' + name) ?? fallback;
        }
        function on(name) {
            return ![false, 'false', '0', 0].includes(setting(name, true));
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
        function rutorPlaceholder() {
            return result('rutor', RUTOR + ' · данные недоступны', [
                {title: 'Открыть рейтинг и повторить проверку', rt24Status: true}
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
                if (kind === 'ru') {
                    bounded(Promise.resolve().then(russianCards).then(function (cards) {
                        return result(kind, RU, cards.slice(0, limit()));
                    }), 8000, null).then(done);
                    return;
                }
                var work = waitForRutor().then(function (api) {
                    if (!api) return rutorPlaceholder();
                    return api.cards(limit(), age()).then(function (cards) {
                        if (!cards.length) return rutorPlaceholder();
                        var status = api.status();
                        var when = status.stale ? ' · сохранённый рейтинг ' + new Date(status.at).toLocaleString('ru-RU', {
                            day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
                        }) : '';
                        return result(kind, RUTOR + when, cards);
                    });
                });
                bounded(work, 11800, rutorPlaceholder()).then(done);
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
                var order = setting('order', 'rutor') === 'ru' ? ['ru', 'rutor'] : ['rutor', 'ru'];
                return order.filter(on).map(function (kind) { return loaders[kind]; });
            }
        });
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
                    if (isRutor && data.rt24Status) {
                        card.use({onlyEnter: more});
                        return;
                    }
                    if (isRutor && !data.rt24Entry) return;
                    card.use({
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
                    card.use({
                        onlyEnter: function () {
                            var api = window.Rutor24Home;
                            var current = L.Activity.active();
                            if (api && current && current.component === 'main') api.openRelease(data.rt24Entry);
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
        L.Listener.follow('activity', function (event) {
            if (event.type !== 'init' || event.component !== 'main') return;
            var component = event.object && event.object.activity && event.object.activity.component;
            if (component && component.use) component.use({onInstance: customize});
        });
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
    }

    function ready() {
        var L = window.Lampa;
        if (!L || !L.Listener) return false;
        if (window.appready) register(L);
        else L.Listener.follow('app', function (event) {
            if (event.type === 'ready') register(L);
        });
        return true;
    }
    if (!ready()) {
        var attempts = 0;
        var wait = setInterval(function () {
            if (ready() || ++attempts === 40) clearInterval(wait);
        }, 250);
    }
})();
