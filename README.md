# Экспресс Трансфер Трэвел

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

Фиксированные цены импортированы из `таблица стоимости поездок.xlsx` в `data/fixed-directions.json`. Для строк таблицы сохранены тарифы эконом, стандарт и комфорт; текущий расчёт заказа использует тариф стандарт и добавляет комиссию платформы 20%.

Направления с фиксированной ценой перечислены в `data/fixed-directions.json`. Таблица цен пока пустая и будет загружена из Excel позже; до загрузки цена фиксированного направления не подменяется расчётом OSRM.

## Telegram-уведомления о назначении машины

Токен бота хранится только в переменной окружения. Сначала напишите боту любое сообщение, затем получите `chat_id` через `https://api.telegram.org/bot<TOKEN>/getUpdates` и запустите сервер:

```powershell
$env:TELEGRAM_BOT_TOKEN = 'токен бота'
$env:TELEGRAM_CHAT_ID = 'ваш chat_id'
npm start
```

После назначения машины через `POST /api/orders/:id/assign` сервер отправляет в Telegram маршрут, дату, клиента, автомобиль и водителя. Никогда не публикуйте токен в HTML, Git или чате.
