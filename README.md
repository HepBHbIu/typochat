# TypoChat

<p align="center">
  <a href="README.md">English</a> •
  <a href="README.ru.md">Русский</a> •
  <a href="README.zh.md">中文</a>
</p>

Anonymous public chat — no registration, no history, just enter a nickname and chat.

## Features

| Feature | Description |
|---------|-------------|
| **No Registration** | Pick a nickname, start chatting |
| **Channels** | Create any channel, auto-delete after 24h inactivity |
| **History** | Last 50 messages per channel |
| **Federation** | Servers sync messages between each other |
| **Anonymous** | No accounts, no tracking |
| **Mobile** | Full responsive design |

## Quick Start

```bash
git clone https://github.com/HepBHbIu/typechat.git
cd typechat
npm install
npm start
```

Open http://localhost:3001

## Federation

```bash
# Server A
PORT=3001 SERVER_NAME=Moscow node server.js

# Server B
PORT=3002 PEERS=http://server-a.com:3001 SERVER_NAME=Berlin node server.js
```

## API

| Endpoint | Description |
|----------|-------------|
| GET `/api/channels` | List channels |
| GET `/api/channels/:id/history` | Get last 50 messages |
| POST `/api/channels` | Create channel |
| GET `/api/stats` | Server stats |

## How It Works

1. Open the page
2. Enter any nickname
3. Pick or create a channel
4. Chat!

## Donation

| Currency | Address |
|----------|---------|
| **Bitcoin** | `1NxFhq7HoiQvBTRRusnsZfoCLpaFdDc3Mm` |
| **Toncoin** | `UQDDiCjIbIJ7JdsiPpavuKdHAhNjHKJ-Hu9YA3ZIH-Rwg2DQ` |
| **Ethereum** | `0x5e736750e1C809C027888E409Cb96c54e331538f` |

## Contact

**Telegram**: [@Figment_of_the_imagination](https://t.me/Figment_of_the_imagination)

## License

MIT
