# Rutor · Топ 24 часа для Lampa

GitHub Pages раздаёт два расширения и снимок суточной таблицы Rutor. GitHub Actions обновляет снимок в 13-ю и 43-ю минуту каждого часа по UTC. Клиент читает `rating.json` рядом с `plugin.js` по HTTPS. `home.js` использует данные через API основного расширения.

## Публикация

Создайте отдельный публичный репозиторий `rutor24-lampa` с основной веткой `main`. Перед отправкой проверьте `git status` в этом каталоге. В репозиторий входят только файлы проекта из этого каталога.

1. В терминале авторизуйте официальный GitHub CLI командой `gh auth login --hostname github.com --git-protocol https --web`. Вход и одноразовый код подтверждайте только на странице GitHub. Проверьте авторизацию через `gh auth status --hostname github.com`.
2. Из каталога проекта выполните `gh repo create rutor24-lampa --public --source=. --remote=origin --push`.
3. В новом репозитории откройте Settings → Pages → Build and deployment → Source → GitHub Actions.
4. В Actions откройте **Rutor rating and Pages** и нажмите **Run workflow** в ветке `main`. Успешное выполнение должно содержать обе задачи, `snapshot` и `deploy`. Проверьте три адреса из следующего раздела.

Документация GitHub об [авторизации CLI](https://cli.github.com/manual/gh_auth_login) и [деплое Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

## Обновление и диагностика

Конкретный адрес Pages появится в Settings → Pages после первого успешного деплоя. Для обычного аккаунта и имени репозитория выше адреса будут такими:

- `https://ВАШ-ЛОГИН.github.io/rutor24-lampa/plugin.js`
- `https://ВАШ-ЛОГИН.github.io/rutor24-lampa/home.js`
- `https://ВАШ-ЛОГИН.github.io/rutor24-lampa/rating.json`

В `rating.json` поле `sourceAt` учитывает возраст кэша, объявленный Rutor. `fetchedAt` показывает время последнего корректного запроса облачной задачи. В приложении снимок помечается устаревшим через 60 минут от времени источника либо после ошибки загрузки. Последний корректный снимок хранится в приложении и на Pages. Ошибка источника останавливает задачу до публикации. При первом запуске без снимка ряд Rutor выводит карточку перехода в каталог и повторной проверки.

Если время перестало меняться, проверьте последнюю задачу **Fetch and validate the official daily table** в Actions. Сбой получения Rutor виден в её журнале. Запустите **Run workflow** вручную после восстановления источника. Расписание GitHub может задерживаться. После 60 дней без активности в публичном репозитории GitHub может отключить запланированные запуски. Тогда нажмите **Enable workflow**, а затем **Run workflow**. [Правила расписания GitHub](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

## Переход на TCL 75C7L

1. Убедитесь, что оба HTTPS-адреса JS и JSON уже открываются и `fetchedAt` свежий.
2. В Lampa отключите обе локальные копии `plugin.js` и `home.js`. Добавьте сначала облачный `plugin.js`, затем облачный `home.js`. Оставьте включённой по одной копии каждого расширения.
3. В настройках Lampa посмотрите текущий адрес TorrServer. Если адрес ведёт на Mac mini, для теста воспроизведения понадобится TorrServer на ТВ или на другом устройстве. Если TorrServer запущен непосредственно на ТВ и доступен по стандартному порту, адрес обычно `http://127.0.0.1:8090`.
4. Выключите Mac mini и завершите Lampa через настройки приложений Android TV. Запустите снова. Проверьте три ряда, дату рейтинга, OK на карточке Rutor, «Открыть в Lampa», затем «Смотреть» и выбор серии при наличии. Вернитесь назад и проверьте фокус.
5. Для отката включите Mac mini, отключите оба облачных расширения, включите обе локальные копии по прежним адресам и перезапустите Lampa.

GitHub Pages хранит расширения и рейтинг. Воспроизведение обслуживает отдельный [TorrServer](https://github.com/YouROK/TorrServer). Существующие настройки TorrServer и парсеров сохраняются при установке.
