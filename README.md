# Экспресс Трансфер Трэвел

## Серверная база данных

Сервер использует SQLite в `data/platform.sqlite` (создаётся автоматически при первом запуске). В БД хранятся пользователи и роли, водители и автомобили, районы, фиксированные направления и тарифы, заказы и платежные статусы. JSON-файлы используются только как исходные данные для первичного заполнения; карта улиц не хранится и не требуется, потому что маршрут строит OSRM.

Проверка инициализации:

```powershell
npm start
Invoke-RestMethod http://localhost:8787/api/test-users
Invoke-RestMethod http://localhost:8787/api/districts
Invoke-RestMethod http://localhost:8787/api/orders
```

## Запуск отправки кодов подтверждения

Страница `index.html` отправляет запросы в локальный сервер `server.mjs`, который отправляет коды по SMTP. Откройте сайт через сервер, а не двойным кликом по `file://`:

```powershell
npm install
$env:SMTP_HOST = 'smtp.example.com'
$env:SMTP_PORT = '465'
$env:SMTP_SECURE = 'true'
$env:SMTP_USER = 'your-mail@example.com'
$env:SMTP_PASS = 'your-app-password'
$env:MAIL_FROM = 'your-mail@example.com'
npm start
```

После запуска откройте `http://localhost:8787`. Для Яндекс 360, Gmail и других провайдеров используйте пароль приложения, если провайдер его требует. Не храните реальные пароли в GitHub.

## Пользователи и роли

Регистрация: `POST /api/auth/client/register` или `POST /api/auth/register` с `email`, `name`, `phone`, `password` и ролью `client`/`driver`. Клиент может передать `channels: ["email", "telegram", "max"]`, а также `telegramHandle` и `maxHandle`; настройки позже изменяются через `PATCH /api/auth/notification-profile`. После подтверждения кода вход выполняется через `POST /api/auth/login`; сессия хранится в HttpOnly-cookie. Текущий профиль доступен через `GET /api/auth/me`. Список пользователей доступен только ролям `admin` и `dispatcher` через `GET /api/users`.

Локальный `TEST_AUTH_MODE=true` разрешает адреса `@example.com` с кодом `000000`; в этом режиме также доступны тестовые `/api/test-users` и `/api/test-users/reset`. Это режим проверки и не заменяет SMTP-аутентификацию production.

## Диспетчерская панель

После входа пользователя с ролью `dispatcher` или `admin` откройте `/dispatcher.html`. Панель показывает заявки и водителей, а назначение принимает только зарегистрированную связку автомобиля и госномера. Серверные операции доступны через `/api/orders/:id/assign`, `/accept`, `/pay-commission`, `/start` и `/complete` с проверкой роли и владельца заказа.

В классификацию автомобилей добавлены `Минивэн 6 мест` и `Минивэн 8 мест`. Вместимость указывается по документам автомобиля и используется отдельно от класса комфорта.

## Платежи

После назначения машины сервер создаёт платёж `pending` на сумму комиссии, `paymentUrl` и `qrPayload` со сроком действия 10 минут. Клиент может получить его через `GET /api/orders/:id/payment` и оплатить в локальном контуре через `POST /api/orders/:id/pay-commission`. Для эквайринга используется `POST /api/payments/webhook`; подпись HMAC SHA-256 передаётся в `X-Payment-Signature`, секрет задаётся `PAYMENT_WEBHOOK_SECRET`. Повторный webhook безопасен и возвращает `idempotent: true`. Отмена: `POST /api/payments/:id/cancel`, возврат staff-ролью: `POST /api/payments/:id/refund`.

## Безопасность и эксплуатация

Сессии хранятся в SQLite в виде SHA-256 хеша токена и переживают перезапуск процесса. Mutation-запросы проверяют `Origin`/Fetch Metadata, включены rate limit и security headers. Аудит доступен только `admin` через `GET /api/audit`. Документы водителя принимаются только через JSON Base64 с whitelist MIME (`PDF/JPEG/PNG`), лимитом 5 МБ и проверкой сигнатуры; endpoint — `POST /api/driver/documents`. Резервная копия: `npm run backup:db`; восстановление: `npm run restore:db -- backups/<file>.sqlite`.

## Локальный OSRM без ключа

Сервер использует только локальный OSRM по `OSRM_URL`. Docker в текущем окружении не установлен, поэтому контейнер нужно подготовить на машине с Docker:

```powershell
New-Item -ItemType Directory -Force osrm
wget https://download.geofabrik.de/europe/russia/kaliningradskaya-latest.osm.pbf -OutFile osrm/kaliningradskaya-latest.osm.pbf
docker run --rm -t -v "${PWD}/osrm:/data" ghcr.io/project-osrm/osrm-backend osrm-extract -p /opt/car.lua /data/kaliningradskaya-latest.osm.pbf
docker run --rm -t -v "${PWD}/osrm:/data" ghcr.io/project-osrm/osrm-backend osrm-partition /data/kaliningradskaya-latest.osrm
docker run --rm -t -v "${PWD}/osrm:/data" ghcr.io/project-osrm/osrm-backend osrm-customize /data/kaliningradskaya-latest.osrm
docker compose -f docker-compose.osrm.yml up -d
```

После запуска проверьте `http://localhost:5000/route/v1/driving/20.4522,54.7104;20.1514,54.9438?overview=false`. Сайт использует этот сервис через `/api/route`.

## Правило стоимости

Для маршрутов без фиксированного тарифа района стоимость рассчитывается только по расстоянию OSRM:

```text
базовая стоимость = расстояние в км × 75 ₽
комиссия платформы = базовая стоимость × 20%
итого к оплате клиентом = базовая стоимость + комиссия
```

Расчёт возвращается в `basePriceRub`, `commissionRub` и `clientTotalRub` в ответе `/api/route` и сохраняется в заказе.

Фиксированные цены первично импортируются из `data/fixed-directions.json` (источник — `таблица стоимости поездок.xlsx`) в SQLite. Для строк таблицы сохраняются тарифы эконом, стандарт и комфорт; текущий расчёт заказа использует тариф стандарт и добавляет комиссию платформы 20%.

Направления с фиксированной ценой перечислены в `data/fixed-directions.json` и доступны через `GET /api/tariffs`; до загрузки цены фиксированного направления оно не подменяется расчётом OSRM.

Импорт тарифов выполняется ролью `admin` или `dispatcher` через `POST /api/admin/tariffs/import` с JSON `{ "rows": [{ "from": "Аэропорт Храброво", "to": "Светлогорск", "econom": 2350, "standard": 2600, "comfort": 3100 }] }`. Дубли маршрутов и неположительные/пропущенные цены отклоняются целиком с HTTP `422`; повторная загрузка существующего маршрута обновляет его тарифы.

Первый staff-аккаунт создаётся только при явном временном `STAFF_BOOTSTRAP_TOKEN` в окружении и передаче этого токена в регистрацию с ролью `admin` или `dispatcher`; без токена публичное создание staff запрещено.

## Telegram-уведомления о назначении машины

Токен бота хранится только в переменной окружения. Сначала напишите боту любое сообщение, затем получите `chat_id` через `https://api.telegram.org/bot<TOKEN>/getUpdates` и запустите сервер:

```powershell
$env:TELEGRAM_BOT_TOKEN = 'токен бота'
$env:TELEGRAM_CHAT_ID = 'ваш chat_id'
npm start
```

После назначения машины через `POST /api/orders/:id/assign` сервер отправляет в Telegram маршрут, дату, клиента, автомобиль и водителя. Никогда не публикуйте токен в HTML, Git или чате.

При том же назначении сервер отправляет email клиенту и, если у водителя сохранён email, водителю. Результат сохраняется в `order.emailNotifications`; доставка не отменяет назначение при недоступном SMTP. Production SMTP требует `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` и `MAIL_FROM`. Для локальной проверки формирования письма можно задать `SMTP_JSON_TRANSPORT=true`; это не доставляет письмо во внешний почтовый ящик.

## MAX-бот

MAX подключается отдельным секретным каналом через `MAX_BOT_TOKEN` и `MAX_CHAT_ID`; для ролей доступны `MAX_CLIENT_CHAT_ID`, `MAX_DRIVER_CHAT_ID`, `MAX_DISPATCHER_CHAT_ID`, `MAX_ADMIN_CHAT_ID`. При назначении машины и завершении поездки сервер отправляет уведомления через `POST https://platform-api.max.ru/messages`; события сохраняются в таблице `max_events`, максимум выполняется 3 попытки. Журнал staff доступен через `GET /api/max/events`. Chat ID нужно получить после сообщения боту через MAX updates API; токен из чата необходимо отозвать и выпустить новый перед установкой в окружение.

События назначения и завершения записываются в таблицу `telegram_events`; доставка выполняется максимум в 3 попытки. Для раздельных уведомлений задайте `TELEGRAM_CLIENT_CHAT_ID`, `TELEGRAM_DRIVER_CHAT_ID`, `TELEGRAM_DISPATCHER_CHAT_ID`, `TELEGRAM_ADMIN_CHAT_ID`; старый `TELEGRAM_CHAT_ID` остаётся совместимым общим fallback. Staff может просматривать журнал через `GET /api/telegram/events` и повторять неудачное событие через `POST /api/telegram/events/:id/retry`.

## Маршруты и расчёт

Маршрутизация доступна через `GET /api/route?from=...&to=...`; локальный геокодер `GET /api/geocode?q=...` работает по населённым пунктам и ориентирам из серверного справочника. Проверка OSRM — `GET /api/route/health`. При недоступности OSRM сервер возвращает ошибку расчёта и не подменяет маршрут прямым расстоянием.
