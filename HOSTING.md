# Размещение на VPS

Нужен VPS с Node.js 24, Nginx и systemd. Обычный статический хостинг не выполняет регистрацию, заказы, SQLite и уведомления. Репозиторий нельзя публиковать целиком как web-root: HTTP обслуживает только `server.mjs`.

## Файлы и процесс

1. Разместить код в `/opt/expresstransfertravel`, выполнить `npm ci --omit=dev`.
2. Создать системного пользователя `ett` и каталог `/var/lib/expresstransfertravel`, доступный для записи только этому пользователю. Исходники оставить без права записи процессу сервера.
3. Скопировать `deploy/production.env.example` в `/etc/expresstransfertravel.env` с правами root:root 600. Заполнить настоящий `PUBLIC_ORIGIN=https://домен`, контакты, SMTP и секреты. `TEST_AUTH_MODE=false`, `SITE_INDEXABLE=false` до проверки публикации. Пустые токены означают, что доставка не настроена.
4. Установить `deploy/expresstransfertravel.service` в `/etc/systemd/system/`. Проверить, что Node 24 находится по `/usr/bin/node`. Выполнить `systemctl daemon-reload` и `systemctl enable --now expresstransfertravel`.
5. Направить DNS A/AAAA на VPS и получить сертификат для домена. На компьютере с Node запустить `PUBLIC_ORIGIN=https://домен node scripts/render-nginx.mjs`. Установить полученный `deploy/generated/nginx.conf` в Nginx, выполнить `nginx -t`, затем reload. Нужен уже выпущенный сертификат по пути из конфига.
6. Наружу открыть 80/443 и административный SSH. Node 8787 и OSRM 5000 слушают loopback; не открывать их в интернет.

## SEO и включение индексации

Canonical, Open Graph, JSON-LD, robots.txt и sitemap.xml формируются сервером из `PUBLIC_ORIGIN`. В исходнике нет придуманного production-домена. Контакты берутся из `CONTACT_PHONE` и `CONTACT_EMAIL`; до их заполнения показана ссылка на заявку.

После проверки HTTPS, домена, контактов, регистрации и заказа поставить `SITE_INDEXABLE=true` и перезапустить сервис. Проверить `/`, `/robots.txt`, `/sitemap.xml`, редирект `/index.html` на `/`. Тестовая среда закрыта от индексации через meta и X-Robots-Tag; API и служебные панели всегда noindex. Robots.txt не заменяет авторизацию.

Добавить домен в Google Search Console и Яндекс Вебмастер, передать sitemap и подтвердить владение аккаунтом владельца. Live-индексацию и ranking локально проверить нельзя.

## Проверки и ограничения

`curl -f http://127.0.0.1:8787/healthz` проверяет HTTP-процесс; доступность OSRM проверяется отдельно через `/api/route/health`. Логи: `journalctl -u expresstransfertravel`. Домен, сертификат, SMTP и bot chat IDs требуют настройки на VPS.

Платежи остаются mock-контуром до подключения реального эквайринга. Кабинет водителя и привязка личных Telegram/MAX чатов требуют отдельной приёмки. Это не подтверждение production-запуска.

Резервировать SQLite и каталог документов вне VPS, задать срок хранения и регулярно проверять восстановление на отдельной копии. `backup:db` и `restore:db` учитывают `DATA_DIR`; `BACKUP_DIR` задаёт каталог резервных копий. Загружайте окружение сервиса перед запуском команд. Восстанавливать БД только при остановленном приложении, предварительно сохранив текущую копию. Копия SQLite не включает файлы документов.
