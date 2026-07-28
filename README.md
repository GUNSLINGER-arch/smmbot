---
title: SMMBot Enterprise Backend
emoji: 🚀
colorFrom: blue
colorTo: purple
sdk: docker
app_port: 7860
pinned: false
---

# SMMBot Enterprise Backend API

24/7 Cloud Automation Engine for SMMBot.

## Endpoints:
- `GET /api/health` — Health check
- `GET /api/state` — Full database state
- `GET /api/balance` — Marketerum account balance
- `POST /api/campaign/launch` — Launch organic drip campaign
- `POST /api/order/place` — Direct panel order
- `GET /api/events` — Server-Sent Events (SSE) live logs stream
