# TypeChat

<p align="center">
  <a href="README.md">English</a> •
  <a href="README.ru.md">Русский</a> •
  <a href="README.zh.md">中文</a>
</p>

Анонимный публичный чат — без регистрации, просто вводишь ник и общаешься.

## Возможности

| Возможность | Описание |
|-------------|----------|
| **Без регистрации** | Вводишь ник — общаешься |
| **Каналы** | Создавай любой канал, автоудаление через 24ч |
| **История** | Последние 50 сообщений в канале |
| **Federation** | Серверы синхронизируют сообщения |
| **Анонимность** | Нет аккаунтов, нет трекинга |
| **Мобилка** | Полностью адаптивный дизайн |

## Быстрый старт

```bash
git clone https://github.com/HepBHbIu/typechat.git
cd typechat
npm install
npm start
```

Открой http://localhost:3001

## Federation

```bash
# Сервер A
PORT=3001 SERVER_NAME=Moscow node server.js

# Сервер B
PORT=3002 PEERS=http://server-a.com:3001 SERVER_NAME=Berlin node server.js
```

## Как это работает

1. Открываешь страницу
2. Вводишь любой ник
3. Выбираешь или создаёшь канал
4. Общаешься!

## Пожертвования

| Валюта | Адрес |
|--------|-------|
| **Bitcoin** | `1NxFhq7HoiQvBTRRusnsZfoCLpaFdDc3Mm` |
| **Toncoin** | `UQDDiCjIbIJ7JdsiPpavuKdHAhNjHKJ-Hu9YA3ZIH-Rwg2DQ` |
| **Ethereum** | `0x5e736750e1C809C027888E409Cb96c54e331538f` |

## Контакты

**Telegram**: [@Figment_of_the_imagination](https://t.me/Figment_of_the_imagination)

## Лицензия

MIT
