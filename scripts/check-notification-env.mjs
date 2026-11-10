const required = {
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
  MAX_BOT_TOKEN: process.env.MAX_BOT_TOKEN,
  MAX_CHAT_ID: process.env.MAX_CHAT_ID
};
const result = Object.fromEntries(Object.entries(required).map(([key, value]) => [key, { configured: Boolean(value), length: value ? String(value).length : 0 }]));
console.log(JSON.stringify({ valid: Object.values(result).every(item => item.configured), secrets: result }, null, 2));
