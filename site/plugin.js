/* Rutor · Топ 24 часа v0.6.0 cloud | Lampa */
(function () {
    'use strict';

    var SOURCE = 'https://rutor.is/top/';
    var NAME = 'rutor_daily_top_v2';
    var RELEASE_NAME = 'rutor_release_v2';
    var TITLE = 'Rutor · Топ 24 часа';
    var FRESH = 180000;
    var STALE = 60 * 60000;
    var SNAPSHOT_KEY = 'rt24_cloud_snapshot_v1';
    var lastRequest = 0;
    var failed = false;
    var cache, pending;
    var matches = new Map();
    var torrentOpening = false, torrentLaunchAt = 0;
    var categories = {
        '/kino': 'movie', '/nashe_kino': 'movie', '/nauchno_popularnoe': 'video',
        '/seriali': 'tv', '/nashi_seriali': 'tv', '/tv': 'video', '/multiki': 'video', '/anime': 'video',
        '/games': 'exclude', '/knigi': 'exclude',
        '/audio': 'mixed', '/soft': 'mixed', '/inostrannoe': 'mixed',
        '/sport': 'mixed', '/jumor': 'mixed', '/byt': 'mixed', '/other': 'mixed'
    };
    var script = document.currentScript;
    var publishedRatingURL = ''; /* Replaced in the Pages artifact. */
    var ratingURL = publishedRatingURL || (script && script.src ? new URL('rating.json', script.src).href : '');
    var filters = [['all', 'Всё видео'], ['movie', 'Фильмы'], ['tv', 'Сериалы'], ['4k', '4K']];

    function clean(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function describe(title) {
        var years = Array.from(title.matchAll(/\(((?:19|20)\d{2})(?:\s*[-–—]\s*((?:19|20)\d{2})?)?\)/g));
        var year = years[years.length - 1];
        var head = year ? title.slice(0, year.index) : title;
        var tail = year ? title.slice(year.index + year[0].length) : title;
        var format = /\b(?:WEB[ -]?(?:DL(?:Rip)?|Rip)|(?:UHD[ -]?)?Blu[ -]?ray|(?:UHD[ -]?)?BD[ -]?(?:Rip|Remux)|DVD[ -]?(?:Rip|[59])|HDTV(?:Rip)?|HDRip|TVRip|SAT(?:Rip)?|CAMRip|TS|VHSRip|REMUX)\b/i.exec(tail);
        if (!year && format) head = head.slice(0, format.index);
        var names = clean(head.replace(/\[+[^\]]*\]/g, ' ')).split(/\s+\/\s+/);
        var series = /\[+(?:S\d{1,3}|\d{1,3}\s*[xх×]\s*\d|(?:\d+[-–])?\d+\s+из\s+\d|сезон)/i.test(head)
            || /(?:^|\s)(?:сериал|мини-сериал|сезон)(?=\s|$)/i.test(head);
        var program = /\b(?:PC\s*\||RePack|APK|DEB|MSI|EXE|iOS|macOS|Windows|Linux|PS[345]|Nintendo Switch|Xbox)\b/i.test(tail);
        var audio = /\b(?:FLAC|MP3|APE|WAV|AAC|M4A|ALAC|OGG|OPUS|DSD)\b/i.test(tail);
        var publication = /\b(?:EPUB|FB2|PDF|DJVU|CB[ZR]|MOBI|AZW3|DOCX?)\b/i.test(tail);
        var visual = Boolean(format || /\b(?:4320|2160|1080|720|576|480)[pi]\b|\b(?:UHD|DVB|IPTVRip|WEB-Cap|WEBMux|BDMV|MKV|MP4|AVI|MPEG-TS)\b/i.test(tail));
        var quality = clean([format && format[0], (tail.match(/\b(?:4320|2160|1080|720|576|480)[pi]\b|\b(?:[48]K|UHD)\b/gi) || []).join(' '),
            (tail.match(/\b(?:HDR(?:\s?10\+?)?|HLG|Dolby\s+Vision(?:\s+(?:Profile\s+|P)\d+)?|DV|HEVC|AVC|AV1|x26[45]|IMAX|SDR|3D)(?![\w+])/gi) || []).join(' ')].filter(Boolean).join(' · '));
        var sound = tail.match(/(?:HD\s?rezka(?: Studio)?|WinMedia|Red Head Sound|MovieDalen|LostFilm|NewStudio|Кубик в Кубе|Продубляж|Дубляж|Jaskier|Субтитры|Русский|Английский|Украинский|Японский|Корейский)/gi) || [];
        tail.split('|').slice(1).forEach(function (tag) {
            tag = clean(tag);
            if (/^[DPALДРАЛП]\d?(?:,\s*[DPALДРАЛП]\d?)*$/i.test(tag)) sound.push('код перевода ' + tag);
        });
        return {
            names: names.filter(Boolean), year: year ? Number(year[1]) : 0,
            endYear: year && year[2] ? Number(year[2]) : 0,
            series: series, visual: visual, nonvideo: program || publication || (audio && !visual),
            quality: quality, fourK: /\b(?:2160[pi]?|4K|UHD)\b/i.test(tail), sound: sound.join(', ')
        };
    }

    function classify(row, category, hasVideo) {
        var type = categories[category];
        if (type === 'exclude') return 'other';
        if (type === 'movie' || type === 'tv') return type;
        if (type === 'video' || hasVideo || (row.visual && !row.nonvideo)) return row.series ? 'tv' : 'video';
        return row.nonvideo ? 'other' : 'unknown';
    }

    function validateSnapshot(raw) {
        if (typeof raw !== 'string' || raw.length > 262144) throw Error('Некорректный размер рейтинга.');
        var data = JSON.parse(raw);
        if (!data || data.schema !== 1 || data.source !== SOURCE) throw Error('Неизвестный источник рейтинга.');
        var at = Date.parse(data.sourceAt), fetchedAt = Date.parse(data.fetchedAt);
        if (!at || !fetchedAt || at > fetchedAt + 60000 || fetchedAt > Date.now() + 300000 ||
            !Array.isArray(data.rows) || data.rows.length < 10 || data.rows.length > 100) {
            throw Error('Некорректный снимок рейтинга.');
        }
        var ids = new Set();
        var rows = data.rows.map(function (item, index) {
            if (!item || typeof item.id !== 'string' || !/^\d{1,10}$/.test(item.id) || ids.has(item.id) ||
                item.rank !== index + 1 || typeof item.title !== 'string' || !item.title || item.title.length > 1024 ||
                typeof item.date !== 'string' || !item.date || typeof item.size !== 'string' || !item.size ||
                !Number.isSafeInteger(item.seeds) || item.seeds < 0 || !Number.isSafeInteger(item.peers) || item.peers < 0) {
                throw Error('Повреждена строка рейтинга №' + (index + 1) + '.');
            }
            var magnet = typeof item.magnet === 'string' && /^magnet:\?[^\s<>"']{1,4088}$/i.test(item.magnet) &&
                /^urn:btih:(?:[0-9a-f]{40}|[a-z2-7]{32})$/i.test(new URLSearchParams(item.magnet.slice(8)).get('xt') || '') ? item.magnet : '';
            var torrent = typeof item.torrent === 'string' &&
                new RegExp('^https?://(?:d\\.)?rutor\\.(?:info|is)/download/' + item.id + '/?$', 'i').test(item.torrent) ? item.torrent : '';
            if (!magnet && !torrent) throw Error('Отсутствует ссылка раздачи №' + item.rank + '.');
            var category = Object.prototype.hasOwnProperty.call(categories, item.category) ? item.category : '';
            var row = describe(item.title);
            ids.add(item.id);
            return Object.assign(row, {rank: item.rank, id: item.id, title: item.title, date: item.date,
                size: item.size, peers: item.peers, seeds: item.seeds, category: category,
                kind: row.nonvideo ? 'other' : classify(row, category, false), magnet: magnet, torrent: torrent});
        });
        if (!rows.some(function (row) { return visible(row, 'all'); })) throw Error('В рейтинге нет видеозаписей.');
        return {rows: rows, at: at, fetchedAt: fetchedAt};
    }

    function timed(run, ms) {
        return new Promise(function (resolve, reject) {
            var timer = setTimeout(function () { reject(Error('Время ожидания истекло.')); }, ms);
            function finish(fn, value) { clearTimeout(timer); fn(value); }
            try {
                run(function (value) { finish(resolve, value); }, function (error) { finish(reject, error); });
            } catch (error) { finish(reject, error); }
        });
    }

    function download(L, url, native) {
        return timed(function (ok, fail) {
            if (native && L.Reguest) {
                var net = new L.Reguest();
                net.timeout(5800);
                net.native(url, ok, fail, null, {dataType: 'text'});
            } else {
                var xhr = new XMLHttpRequest();
                xhr.open('GET', url);
                xhr.timeout = 5800;
                xhr.onload = function () {
                    if (xhr.status === 200) ok(xhr.responseText);
                    else fail(Error('HTTP ' + xhr.status));
                };
                xhr.onerror = xhr.ontimeout = fail;
                xhr.send();
            }
        }, 6200);
    }

    function getTop(L, force, maxAge) {
        if (pending) return pending;
        if (!cache) {
            try {
                var stored = window.localStorage.getItem(SNAPSHOT_KEY);
                if (stored) cache = validateSnapshot(stored);
            } catch (_) {}
        }
        function state() {
            return Object.assign({}, cache, {stale: failed || Date.now() - cache.at > STALE});
        }
        var minAge = failed || force ? 60000 : maxAge || FRESH;
        if (Date.now() - lastRequest < minAge) {
            return cache ? Promise.resolve(state()) : Promise.reject(Error('Ожидаем повторной проверки облака.'));
        }
        if (!/^https:\/\//i.test(ratingURL) && !(window.__RUTOR24_TEST__ && ratingURL)) {
            failed = true;
            return cache ? Promise.resolve(state()) : Promise.reject(Error('Не найден HTTPS-адрес рейтинга.'));
        }
        lastRequest = Date.now();
        var android = L.Platform && L.Platform.is('android');
        pending = download(L, ratingURL + (force ? '?_=' + lastRequest : ''), android).then(function (raw) {
            var next = validateSnapshot(raw);
            if (cache && next.at < cache.at) throw Error('Облако вернуло более старую версию рейтинга.');
            cache = next;
            failed = false;
            try { window.localStorage.setItem(SNAPSHOT_KEY, raw); } catch (_) {}
            return state();
        }).catch(function (error) {
            failed = true;
            if (cache) return state();
            throw error;
        }).finally(function () { pending = null; });
        return pending;
    }

    function normalize(text) {
        return clean(String(text || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/gi, ' '));
    }

    function pickMatch(list, row) {
        var expected = row.names.map(normalize);
        var candidates = list.map(function (card) {
            if (!card || !card.id || (card.media_type !== 'tv' && card.media_type !== 'movie')) return null;
            if ((row.kind === 'tv' || row.kind === 'movie') && card.media_type !== row.kind) return null;
            var hit = [card.title || card.name, card.original_title || card.original_name].map(normalize)
                .filter(function (name) { return name && expected.indexOf(name) >= 0; });
            if (!hit.length) return null;
            var year = parseInt(card.release_date || card.first_air_date, 10);
            if (row.year && !year) return null;
            var gap = row.year ? row.year - year : 0;
            if (row.endYear && year >= row.year && year <= row.endYear) gap = 0;
            if (card.media_type === 'movie' && Math.abs(gap) > 1) return null;
            if (card.media_type === 'tv' && (gap < -1 || gap > (row.series ? 20 : 1))) return null;
            var score = 100 - Math.abs(gap) * 3 + (hit.length > 1 && hit[0] !== hit[1] ? 5 : 0);
            if (card.media_type === row.kind) score += 3;
            return {score: score, card: card};
        }).filter(Boolean).sort(function (a, b) { return b.score - a.score; });
        if (!candidates.length || (candidates[1] && candidates[0].score === candidates[1].score)) return null;
        return Object.assign({}, candidates[0].card, {source: 'tmdb'});
    }

    function lookup(L, row) {
        var key = [row.kind, row.year, row.names.map(normalize).join('|')].join(':');
        var saved = matches.get(key);
        if (saved && Date.now() < saved.until) return saved.promise;
        var api = L.Api && L.Api.sources && L.Api.sources.tmdb;
        if (!api || !api.get || !row.names.length) return Promise.resolve(null);
        var queries = Array.from(new Set(row.names.map(clean).filter(Boolean))).slice(0, 4);
        var serviceFailed = false;
        var found = new Map();
        function next(index) {
            if (!queries[index]) return Promise.resolve(pickMatch(Array.from(found.values()), row));
            return timed(function (ok, no) {
                api.get('search/multi', {query: queries[index], langs: 'ru-RU'}, ok, no);
            }, 11500).then(function (result) {
                var list = result && Array.isArray(result.results) ? result.results : [];
                list.forEach(function (card) { found.set(card.media_type + ':' + card.id, card); });
                return next(index + 1);
            }, function () {
                serviceFailed = true;
                return next(index + 1);
            });
        }
        if (matches.size >= 96) matches.delete(matches.keys().next().value);
        var item = {until: Date.now() + 50000};
        item.promise = next(0).then(function (card) {
            item.until = Date.now() + (card ? 3600000 : serviceFailed ? 30000 : 300000);
            return card && {
                id: card.id, source: 'tmdb', media_type: card.media_type, title: card.title, name: card.name,
                original_title: card.original_title, original_name: card.original_name, poster_path: card.poster_path,
                backdrop_path: card.backdrop_path, vote_average: card.vote_average, overview: String(card.overview || '').slice(0, 2000), release_date: card.release_date, first_air_date: card.first_air_date
            };
        });
        matches.set(key, item);
        return item.promise;
    }

    function visible(row, filter, card) {
        var kind = card ? card.media_type : row.kind;
        return (row.kind !== 'other' && row.kind !== 'unknown') && (filter === 'all' || (filter === '4k' ? row.fourK : kind === filter));
    }

    function node(tag, cls, value) {
        var element = document.createElement(tag);
        element.className = cls || '';
        if (value != null) element.textContent = value;
        return element;
    }

    function register(L) {
        if (window.__rutor24v2) return;
        var icon = '<svg viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="18" cy="18" r="13"/><path d="M18 9v10l6 4"/></svg>';
        var css = node('style');
        css.textContent =
            '.rt24-bar{display:flex;flex-wrap:wrap;padding:1em 1.5em .4em}' +
            '.rt24-button{padding:.65em .9em;margin:.25em;border-radius:.65em;background:#303038;color:#fff;border:0;font:inherit}' +
            '.rt24-button.rt24-on{background:#eac46f;color:#221b10}.rt24-button.focus{outline:.15em solid #fff}' +
            '.rt24-status{min-height:2em;padding:0 1.75em;color:#e0d9cc;font-size:.9em}' +
            '.category-full.rt24-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:1.15em .55em;padding:0 1.35em 1.2em;align-items:start}' +
            '.rt24-grid .card{width:100%;min-width:0;margin:0;padding:0;box-sizing:border-box}.rt24-grid .card__img{object-fit:contain}' +
            '.rt24-grid .card__title{overflow-wrap:anywhere}.rt24-grid .card__view{padding-bottom:150%}' +
            '@media(max-width:700px){.category-full.rt24-grid{grid-template-columns:repeat(4,minmax(0,1fr))}}' +
            '@media(max-width:420px){.category-full.rt24-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}' +
            '.rt24-rank{position:absolute;right:.55em;top:.55em;background:rgba(0,0,0,.75);color:#fff;border-radius:.45em;padding:.2em .42em;font-size:.84em}' +
            '.rt24-detail{line-height:1.45;overflow-wrap:anywhere}.rt24-detail p{margin:0 0 .65em}' +
            '.rt24-release-screen{padding:1.5em 2em 3em;box-sizing:border-box;min-height:100%}' +
            '.rt24-release-title{font-size:1.8em;line-height:1.25;margin:0 0 .4em;overflow-wrap:anywhere}' +
            '.rt24-release-subtitle{opacity:.68;margin-bottom:1.25em}' +
            '.rt24-release-screen .torrent-item{margin:0 0 1.2em;white-space:normal}' +
            '.rt24-release-screen .torrent-item__title{white-space:normal;overflow-wrap:anywhere}' +
            '.rt24-release-screen .torrent-item__details{white-space:normal;flex-wrap:wrap;gap:.25em .6em}' +
            '.rt24-release-meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.6em 1.5em;margin:1.2em 0 1.6em;font-size:1.05em}' +
            '.rt24-release-meta div{overflow-wrap:anywhere}.rt24-release-meta b{color:rgba(255,255,255,.62);font-weight:500;margin-right:.35em}' +
            '.rt24-release-actions{display:flex;flex-wrap:wrap;gap:.7em}.rt24-release-actions .full-start__button{margin:0}' +
            '.rt24-release-actions .full-start__button.focus{outline:.15em solid #fff}' +
            '@media(max-width:700px){.rt24-release-screen{padding:1em}.rt24-release-meta{grid-template-columns:1fr}}';
        document.head.appendChild(css);

        function startTorrent(row, card, poster) {
            var current = L.Activity.active();
            if (!current || current.component !== RELEASE_NAME || torrentOpening || Date.now() - torrentLaunchAt < 500) return;
            if (!row.magnet && !row.torrent) return L.Noty.show('У этой раздачи нет ссылки на торрент в таблице Rutor.');
            if (!L.Torrent || typeof L.Torrent.start !== 'function') return L.Noty.show('В этой сборке Lampa недоступен штатный запуск торрентов.');
            torrentOpening = true;
            torrentLaunchAt = Date.now();
            try {
                var title = (row.names[0] || 'Видео').replace(/[<>&"']/g, '');
                var movie = card ? Object.assign({}, card) : {title: title, original_title: title};
                if (row.kind === 'tv' && !movie.name) {
                    movie.name = title;
                    movie.original_name = title;
                }
                L.Torrent.start({
                    title: row.title.replace(/[<>&"']/g, ''),
                    MagnetUri: row.magnet || undefined,
                    Link: row.torrent || undefined,
                    poster: poster || '',
                    Tracker: 'Rutor'
                }, movie);
            } catch (error) {
                L.Noty.show('Не удалось открыть раздачу через Lampa.');
                console.warn('Rutor24 Torrent.start:', error.message);
            } finally {
                setTimeout(function () { torrentOpening = false; }, 450);
            }
        }

        function ReleaseScreen(activity) {
            var self = this;
            var row = activity.row || {names: []};
            var movie = activity.movie || null;
            var root = node('div', 'torrent-list rt24-release-screen');
            var scroll = new L.Scroll({mask: true, over: true});
            var title = node('h1', 'rt24-release-title', row.title || 'Раздача Rutor');
            var subtitle = node('div', 'rt24-release-subtitle', 'Rutor · Топ 24 часа · позиция № ' + (row.rank || '—'));
            var rowItem = L.Template.js('torrent');
            var actions = node('div', 'rt24-release-actions');
            var watch = node('div', 'full-start__button selector', '▶ Смотреть');
            var open = node('div', 'full-start__button selector', '🎬 Открыть в Lampa');
            var seasonMatch = row.title && row.title.match(/(?:S(\d{1,3})\s*E(\d{1,3}(?:\s*[-–]\s*E?\d{1,3})?)|(?:сезон\s*(\d{1,3}))[\s,;:]+(?:серии?\s*)?(\d{1,3}(?:\s*[-–]\s*\d{1,3})?))/i);
            var fullActivity = null;
            var busy = false;

            rowItem.classList.remove('selector', 'layer--visible');
            var torrentTitle = rowItem.querySelector('.torrent-item__title');
            var date = rowItem.querySelector('.torrent-item__date');
            var tracker = rowItem.querySelector('.torrent-item__tracker');
            var quality = rowItem.querySelector('.torrent-item__bitrate');
            var seeds = rowItem.querySelector('.torrent-item__seeds');
            var peers = rowItem.querySelector('.torrent-item__grabs');
            var size = rowItem.querySelector('.torrent-item__size');
            torrentTitle.textContent = row.title || '';
            date.textContent = row.date || '';
            tracker.textContent = 'Rutor · № ' + (row.rank || '—');
            quality.innerHTML = 'Качество: <span></span>';
            quality.querySelector('span').textContent = row.quality || 'не указано';
            seeds.innerHTML = 'Раздающих: <span></span>';
            seeds.querySelector('span').textContent = String(row.seeds == null ? '—' : row.seeds);
            peers.innerHTML = 'Скачивающих: <span></span>';
            peers.querySelector('span').textContent = String(row.peers == null ? '—' : row.peers);
            size.textContent = row.size || 'Размер не указан';

            var meta = node('div', 'rt24-release-meta');
            function metaLine(label, value) {
                if (!value) return;
                var line = node('div');
                line.appendChild(node('b', '', label));
                line.appendChild(document.createTextNode(value));
                meta.appendChild(line);
            }
            metaLine('Позиция:', row.rank ? '№ ' + row.rank : '');
            metaLine('Дата публикации:', row.date || '');
            metaLine('Качество / HDR / Dolby Vision:', row.quality || 'Не определено в названии раздачи');
            metaLine('Размер:', row.size || 'Не указан');
            metaLine('Раздающих / скачивающих:', (row.seeds == null ? '—' : row.seeds) + ' / ' + (row.peers == null ? '—' : row.peers));
            metaLine('Озвучка и языки:', row.sound || 'Не определены в названии раздачи');
            if (row.kind === 'tv' || row.series) {
                var episodeText = seasonMatch ? (seasonMatch[1] ? 'сезон ' + seasonMatch[1] + ', серия ' + seasonMatch[2] : 'сезон ' + seasonMatch[3] + ', серии ' + seasonMatch[4]) : 'сведения указаны в названии релиза';
                metaLine('Сериал:', episodeText);
            }

            actions.appendChild(watch);
            actions.appendChild(open);
            root.appendChild(title);
            root.appendChild(subtitle);
            root.appendChild(rowItem);
            root.appendChild(meta);
            root.appendChild(actions);
            scroll.append(root);
            this.create = function () { return this.render(); };
            this.render = function (native) { return native ? scroll.render(true) : scroll.render(); };
            this.start = function () {
                busy = false;
                L.Controller.add('content', {
                    link: self,
                    toggle: function () {
                        L.Controller.collectionSet(root);
                        L.Controller.collectionFocus(watch, root);
                    },
                    left: function () { if (window.Navigator.canmove('left')) window.Navigator.move('left'); },
                    right: function () { if (window.Navigator.canmove('right')) window.Navigator.move('right'); },
                    up: function () { if (window.Navigator.canmove('up')) window.Navigator.move('up'); },
                    down: function () { if (window.Navigator.canmove('down')) window.Navigator.move('down'); },
                    back: function () { L.Activity.backward(); }
                });
                L.Controller.toggle('content', true);
                L.Controller.collectionSet(root);
                L.Controller.collectionFocus(watch, root);
            };
            watch.addEventListener('hover:enter', function () {
                if (busy || !L.Activity.active() || L.Activity.active().component !== RELEASE_NAME) return;
                busy = true;
                startTorrent(row, movie, activity.poster || '');
                setTimeout(function () { busy = false; }, 500);
            });
            open.addEventListener('hover:enter', function () {
                if (busy || !L.Activity.active() || L.Activity.active().component !== RELEASE_NAME) return;
                if (!movie || !movie.id) return L.Noty.show('Для этой раздачи не удалось подобрать карточку фильма в Lampa.');
                busy = true;
                L.Router.call('full', Object.assign({}, movie));
                fullActivity = L.Activity.active();
                setTimeout(function () { busy = false; }, 450);
            });
            function stopLateFull(event) {
                if (event.count < 2 || !fullActivity || L.Activity.active() !== fullActivity) return;
                if (fullActivity.activity) fullActivity.activity.is_started = false;
                fullActivity = null;
            }
            this.pause = function () {};
            this.destroy = function () {
                if (L.Activity && L.Activity.listener) L.Activity.listener.remove('backward', stopLateFull);
                scroll.destroy();
                root.remove();
            };
            if (L.Activity && L.Activity.listener) L.Activity.listener.follow('backward', stopLateFull);
        }

        function Screen() {
            var self = this;
            var root = node('div');
            var scroll = new L.Scroll({mask: true, over: true});
            var panel = node('div', 'rt24');
            var bar = node('div', 'rt24-bar');
            var status = node('div', 'rt24-status');
            var grid = node('div', 'rt24-grid category-full');
            var buttons = {}, cards = [], current = 'all';
            var selection, active, dead, busy, snapshot, generation = 0, timer;
            var restore = false, returnFocusPending = false, returnFocusTimer = 0, cardActivity = null;
            var posterJobs = new Map(), near = new Set(), inFlight = new Set(), frame = 0;
            var placeholder = './img/img_broken.svg';
            var observer = window.IntersectionObserver ? new IntersectionObserver(function (changes) {
                changes.forEach(function (change) {
                    var entry = posterJobs.get(change.target);
                    if (!entry) return;
                    if (change.isIntersecting) near.add(entry);
                    else near.delete(entry);
                });
                schedulePosters();
            }, {rootMargin: '60px'}) : null;
            [bar, status, grid].forEach(function (child) { panel.appendChild(child); });
            scroll.append(panel);
            scroll.onScroll = schedulePosters;
            root.appendChild(scroll.render(true));

            function bind(element, click) {
                element.addEventListener('hover:enter', click);
                element.addEventListener('hover:focus', function () {
                    selection = element;
                    if (!restore) scroll.update(element);
                    schedulePosters();
                });
                // Lampa dispatches hover:enter for pointer clicks and remote OK.
            }

            function schedulePosters() {
                if (!active || dead || frame || !posterJobs.size) return;
                frame = requestAnimationFrame(function () {
                    frame = 0;
                    if (!active || dead || !L.Controller.own(self)) return;
                    if (!observer) {
                        posterJobs.forEach(function (entry) {
                            if (!entry.element.classList.contains('selector')) return;
                            var bounds = entry.element.getBoundingClientRect();
                            if (bounds.bottom > 0 && bounds.top < window.innerHeight + 60) near.add(entry);
                            else near.delete(entry);
                        });
                    }
                    while (inFlight.size < 2 && near.size) {
                        var entry = near.values().next().value;
                        near.delete(entry);
                        if (!entry.element.classList.contains('selector') || !posterJobs.delete(entry.element)) continue;
                        if (observer) observer.unobserve(entry.element);
                        startPoster(entry);
                    }
                });
            }

            function startPoster(entry) {
                var loader = new Image();
                var timeout;
                inFlight.add(entry);
                function finish(success) {
                    if (!inFlight.delete(entry)) return;
                    clearTimeout(timeout);
                    loader.onload = loader.onerror = null;
                    entry.cancelPoster = null;
                    if (success) {
                        loader.className = entry.image.className;
                        loader.alt = '';
                        entry.image.replaceWith(loader);
                        entry.image = loader;
                    } else loader.removeAttribute('src');
                    schedulePosters();
                }
                entry.cancelPoster = function () { finish(false); };
                timeout = setTimeout(entry.cancelPoster, 8500);
                loader.onload = function () { finish(true); };
                loader.onerror = entry.cancelPoster;
                loader.src = entry.posterUrl;
            }

            function focus(target, keepScroll) {
                if (!active || !L.Controller.own(self)) return;
                L.Controller.collectionSet(panel);
                restore = !!keepScroll;
                try {
                    L.Controller.collectionFocus(target && panel.contains(target) && target.classList.contains('selector') ? target : buttons[current], panel);
                } finally {
                    restore = false;
                }
                schedulePosters();
            }

            function applyFilter(filter, takeFocus) {
                current = filter;
                filters.forEach(function (item) { buttons[item[0]].classList.toggle('rt24-on', item[0] === current); });
                var count = 0;
                cards.forEach(function (entry) {
                    var show = visible(entry.row, filter, entry.card);
                    entry.element.style.display = show ? '' : 'none';
                    entry.element.classList.toggle('selector', show);
                    if (show) count++;
                });
                if (snapshot) {
                    var format = {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'};
                    var at = new Date(snapshot.at).toLocaleString('ru-RU', format);
                    var checked = new Date(snapshot.fetchedAt).toLocaleString('ru-RU', format);
                    status.textContent = (busy ? 'Обновляем рейтинг… ' : (snapshot.stale || Date.now() - snapshot.at > STALE) ? 'Рейтинг может быть устаревшим · ' : 'Рейтинг Rutor · ') +
                        at + ' · проверено ' + checked + ' · ' + count + ' видео из ' + snapshot.rows.length + ' раздач' + (count ? '' : ' · В этом фильтре пусто');
                }
                if (takeFocus) focus(buttons[current]);
                schedulePosters();
            }

            function restoreFromLateFull(event) {
                if (!returnFocusPending || !cardActivity || !L.Activity || !L.Activity.active) return;
                var current = L.Activity.active();
                if (current !== cardActivity || current.component !== 'full') return;
                // Stop the popped Full activity before its in-flight response can restart it.
                if (cardActivity.activity) cardActivity.activity.is_started = false;
                returnFocusPending = false;
                cardActivity = null;
                clearTimeout(returnFocusTimer);
            }

            function canOpen() {
                return active && !dead && L.Controller.own(self) &&
                    !(L.Modal && L.Modal.opened && L.Modal.opened());
            }

            function openRelease(entry) {
                if (!canOpen()) return;
                selection = entry.element;
                openReleaseScreen(entry.row, entry.card, entry.posterUrl);
            }

            function openCard(entry) {
                if (!entry.card) {
                    L.Noty.show(entry.checking ? 'Подбираем карточку TMDB…' : 'Карточка Lampa для этой раздачи не найдена.');
                    return;
                }
                var card = Object.assign({}, entry.card);
                returnFocusPending = true;
                clearTimeout(returnFocusTimer);
                returnFocusTimer = setTimeout(function () { returnFocusPending = false; }, 15000);
                if (L.Router && L.Router.call) L.Router.call('full', card);
                else L.Activity.push({component: 'full', url: '', id: card.id, method: card.media_type, source: 'tmdb', card: card, page: 1});
                cardActivity = L.Activity.active();
            }

            function showInfo(entry) {
                var row = entry.row;
                var info = node('div', 'rt24-detail');
                [
                    row.title, [row.quality, row.size].filter(Boolean).join(' · '),
                    'Раздающих: ' + row.seeds + ' · скачивающих: ' + row.peers + ' · ' + row.date,
                    row.sound && 'Озвучка: ' + row.sound
                ].filter(Boolean).forEach(function (line) { info.appendChild(node('p', '', line)); });
                var url = 'https://rutor.is/torrent/' + row.id;
                var link = node('a', '', url);
                link.href = url;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                info.appendChild(link);
                function close() {
                    L.Modal.close();
                    if (!active || dead) return;
                    if (!L.Controller.own(self)) L.Controller.toggle('content', true);
                    else if (window.Navigator.getFocusedElement() !== selection) focus(selection, true);
                }
                L.Modal.open({title: '№ ' + row.rank + ' · Информация о раздаче',
                    html: $(info), size: 'medium', buttons: [
                        {name: 'Открыть Rutor', onSelect: function () {
                            if (L.Platform.is('android') && L.Android && L.Android.openBrowser) L.Android.openBrowser(url);
                            else window.open(url, '_blank', 'noopener');
                        }},
                        {name: 'Закрыть', onSelect: close}
                    ], onBack: close});
            }

            function actions(entry) {
                if (!canOpen()) return;
                selection = entry.element;
                L.Select.show({
                    title: 'Раздача № ' + entry.row.rank,
                    items: [
                        {title: 'Карточка Lampa', card: true},
                        {title: 'Информация о раздаче'}
                    ],
                    onBack: function () { if (!L.Controller.own(self)) L.Controller.toggle('content'); },
                    onSelect: function (item) {
                        if (!L.Controller.own(self)) L.Controller.toggle('content');
                        if (item.card) openCard(entry);
                        else showInfo(entry);
                    }
                });
            }

            function makeCard(row) {
                var title = (row.names[0] || 'Видео').slice(0, 110);
                // Use the native template and focus CSS without its second image lifecycle.
                var element = L.Template.js('card');
                element.classList.remove('layer--visible');
                var image = element.querySelector('.card__img');
                var view = element.querySelector('.card__view');
                element.classList.add('rt24-card', 'card--loaded');
                var age = element.querySelector('.card__age');
                element.setAttribute('data-release', row.id);
                image.alt = '';
                image.src = placeholder;
                element.querySelector('.card__title').textContent = title;
                if (age) age.textContent = row.year || '';
                view.appendChild(node('span', 'rt24-rank', '№ ' + row.rank));
                var entry = {row: row, element: element, image: image, checking: true};
                entry.decorate = function (card) {
                    if (L.Api && L.Api.sources && L.Api.sources.tmdb && L.Api.sources.tmdb.img &&
                        card.poster_path && /^\/[\w.-]+$/.test(card.poster_path)) {
                        entry.posterUrl = L.Api.sources.tmdb.img(card.poster_path);
                        posterJobs.set(element, entry);
                        if (observer) observer.observe(element);
                        schedulePosters();
                    }
                    var vote = Number(card.vote_average);
                    if (vote > 0 && vote <= 10) view.appendChild(node('span', 'card__vote', vote.toFixed(1)));
                    element.querySelector('.card__title').textContent = card.title || card.name || title;
                    var year = String(card.release_date || card.first_air_date || row.year || '').slice(0, 4);
                    if (year && !age) {
                        age = node('div', 'card__age');
                        element.appendChild(age);
                    }
                    if (age) age.textContent = year;
                };
                bind(element, function () { openRelease(entry); });
                element.addEventListener('hover:long', function () { actions(entry); });
                return entry;
            }

            function clearCards() {
                if (observer) observer.disconnect();
                posterJobs.clear();
                near.clear();
                if (frame) cancelAnimationFrame(frame);
                frame = 0;
                inFlight.forEach(function (entry) { entry.cancelPoster(); });
                cards = [];
                grid.textContent = '';
            }

            function draw(data) {
                var epoch = ++generation;
                var selectedRelease = selection && selection.getAttribute('data-release');
                var selectedButton = selection && bar.contains(selection) ? selection : buttons[current];
                snapshot = data;
                clearCards();
                function insert(row) {
                    var entry = makeCard(row);
                    var index = cards.findIndex(function (item) { return item.row.rank > row.rank; });
                    if (index < 0) index = cards.length;
                    grid.insertBefore(entry.element, cards[index] ? cards[index].element : null);
                    cards.splice(index, 0, entry);
                    return entry;
                }
                data.rows.filter(function (row) { return visible(row, 'all'); }).forEach(insert);
                applyFilter(current, false);
                focus((selectedRelease && grid.querySelector('.selector[data-release="' + selectedRelease + '"]')) || selectedButton);
                var queue = cards.slice();
                function next() {
                    if (dead || epoch !== generation || !queue.length) return;
                    var prepared = Promise.resolve(queue.shift());
                    prepared.then(function (item) {
                        if (!item || dead || epoch !== generation) return null;
                        return lookup(L, item.row).then(function (card) {
                            if (dead || epoch !== generation) return;
                            item.checking = false;
                            if (!card) return;
                            var changed = visible(item.row, current, item.card) !== visible(item.row, current, card);
                            item.card = card;
                            item.decorate(card);
                            if (changed) {
                                applyFilter(current, false);
                                focus(selection, true);
                            }
                        });
                    }).catch(function (error) {
                        console.warn('Rutor24:', error.message);
                    }).then(next);
                }
                for (var i = 0; i < 3; i++) next();
            }

            function refresh(force) {
                if (busy || dead) return;
                busy = true;
                if (snapshot) applyFilter(current, false);
                else status.textContent = 'Загружаем суточный рейтинг Rutor…';
                getTop(L, force).then(function (data) {
                    if (dead) return;
                    busy = false;
                    if (snapshot && (snapshot.rows === data.rows || JSON.stringify(snapshot.rows) === JSON.stringify(data.rows))) {
                        snapshot = data;
                        applyFilter(current, false);
                    } else draw(data);
                }, function (error) {
                    if (dead) return;
                    busy = false;
                    status.textContent = 'Не удалось загрузить рейтинг. Проверьте интернет и нажмите «Обновить».';
                });
            }

            filters.forEach(function (item) {
                var button = node('button', 'rt24-button selector', item[1]);
                button.type = 'button';
                buttons[item[0]] = button;
                bind(button, function () { applyFilter(item[0], true); });
                bar.appendChild(button);
            });
            var update = node('button', 'rt24-button selector', 'Обновить');
            update.type = 'button';
            bind(update, function () { refresh(true); });
            bar.appendChild(update);

            this.create = function () {
                if (L.Activity && L.Activity.listener) L.Activity.listener.follow('backward', restoreFromLateFull);
                scroll.minus();
                applyFilter(current, false);
                refresh(false);
                return root;
            };
            this.render = function (native) { return native ? root : $(root); };
            this.start = function () {
                active = true;
                if (scroll.restorePosition) scroll.restorePosition();
                L.Controller.add('content', {
                    link: self,
                    toggle: function () { focus(selection, true); },
                    left: function () {
                        if (window.Navigator.canmove('left')) window.Navigator.move('left');
                        else L.Controller.toggle('menu');
                    },
                    right: function () { window.Navigator.move('right'); },
                    down: function () { window.Navigator.move('down'); },
                    up: function () {
                        if (window.Navigator.canmove('up')) window.Navigator.move('up');
                        else L.Controller.toggle('head');
                    },
                    back: function () { L.Activity.backward(); }
                });
                L.Controller.toggle('content');
                clearInterval(timer);
                timer = setInterval(function () {
                    if (L.Controller.own(self)) refresh(false);
                }, FRESH);
            };
            this.pause = this.stop = function () {
                active = false;
                if (frame) cancelAnimationFrame(frame);
                frame = 0;
                clearInterval(timer);
            };
            this.destroy = function () {
                this.pause();
                dead = true;
                clearTimeout(returnFocusTimer);
                if (L.Activity && L.Activity.listener) L.Activity.listener.remove('backward', restoreFromLateFull);
                clearCards();
                scroll.destroy();
                root.remove();
            };
        }

        function openReleaseScreen(row, movie, poster) {
            var current = L.Activity.active();
            if (current && current.component === RELEASE_NAME) return;
            L.Activity.push({component: RELEASE_NAME, title: 'Раздача № ' + row.rank,
                row: row, movie: movie, poster: poster || ''});
        }

        var homeMatches = new Map();
        var homeRankStatus = {};
        function homeCards(limit, maxAge) {
            return getTop(L, false, maxAge).then(function (data) {
                homeRankStatus = {stale: data.stale, at: data.at};
                var rows = data.rows.filter(function (row) {
                    return visible(row, 'all') && !row.nonvideo;
                }).slice(0, limit);
                var results = rows.map(function (row) {
                    return {title: row.names[0] || row.title, release_date: row.year ? String(row.year) : '',
                        source: 'tmdb', rt24Entry: {row: row}};
                });
                var index = 0;
                var expired = false;
                function worker() {
                    if (expired || index >= rows.length) return Promise.resolve();
                    var i = index++;
                    var row = rows[i];
                    var saved = homeMatches.get(row.id);
                    var match = saved && saved.title === row.title && saved.until > Date.now()
                        ? Promise.resolve(saved.card) : lookup(L, row);
                    return match.then(function (card) {
                        if (homeMatches.size >= 96) homeMatches.delete(homeMatches.keys().next().value);
                        homeMatches.set(row.id, {title: row.title, card: card, until: Date.now() + (card ? 3600000 : 60000)});
                        if (!expired && card) {
                            var poster = card.poster_path ? L.Api.sources.tmdb.img(card.poster_path) : '';
                            Object.assign(results[i], card, {rt24Entry: {row: row, card: card, poster: poster}});
                        }
                    }).catch(function () {}).then(worker);
                }
                return new Promise(function (resolve) {
                    var timer = setTimeout(finish, 2800);
                    function finish() {
                        if (expired) return;
                        expired = true;
                        clearTimeout(timer);
                        resolve(results);
                    }
                    Promise.all([worker(), worker(), worker()]).then(finish);
                });
            });
        }

        window.Rutor24Home = {
            cards: homeCards,
            status: function () { return homeRankStatus; },
            openCatalog: function () {
                L.Activity.push({component: NAME, title: TITLE, url: '', page: 1});
            },
            openRelease: function (entry) {
                openReleaseScreen(entry.row, entry.card, entry.poster);
            }
        };
        L.Component.add(RELEASE_NAME, ReleaseScreen);
        L.Component.add(NAME, Screen);
        L.Menu.addButton(icon, TITLE, function () {
            L.Activity.push({component: NAME, title: TITLE, url: '', page: 1});
        });
        window.__rutor24v2 = true;
    }

    if (window.__RUTOR24_TEST__) window.__RUTOR24_TEST__.api = {
        validateSnapshot: validateSnapshot, classify: classify, describe: describe, pickMatch: pickMatch, lookup: lookup, visible: visible, getTop: getTop, register: register
    };
    if (window.Lampa) {
        if (window.appready) register(window.Lampa);
        else window.Lampa.Listener.follow('app', function (event) {
            if (event.type === 'ready') register(window.Lampa);
        });
    }
})();
