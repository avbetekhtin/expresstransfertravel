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
