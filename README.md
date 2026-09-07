# Rhythm - Daily Habits

An installable PWA for tracking recurring daily and weekly habits: reminders, streaks, and adherence stats. Local-first - all data stays on the device.

![icon](public/icons/icon-192.png)

## Features

- **Today view** - checklist of what's due today with a progress ring and one-tap check-off
- **Full schedule CRUD** - habits with emoji, color, notes, optional target time (e.g. "stop eating by 20:00")
- **Recurrence** - daily, or weekly on specific weekdays
- **Reminders** - per-habit reminder times (see platform notes below)
- **Adherence tracking** - current/best streaks, 7- and 30-day adherence, 12-week heatmap per habit
- **Backup** - JSON export/import of all data
- **PWA** - installable, offline-capable (service worker + cache-first app shell), app-badge with today's remaining count

## Stack

Vite + React 18 + TypeScript. No backend; state lives in `localStorage`. Hand-rolled service worker (`public/sw.js`) and web app manifest.

## Develop

```bash
npm install
npm run dev
```

## Build

```bash
npm run build   # outputs static site to dist/, base path /rhythm/
```

## Deploy (GitHub Pages)

The site is deployed from the `gh-pages` branch (contents of `dist/`):

```bash
npm run build
git subtree push --prefix dist origin gh-pages   # or: push dist/ contents to gh-pages any way you like
```

Live at https://shyalon.github.io/rhythm/

## Notification platform notes (honest version)

- **Android / desktop Chrome, Edge**: local `Notification` reminders fire while the app is open or running in the background, after the user grants permission.
- **iOS / iPadOS**: `new Notification()` is **not supported**, even in installed PWAs. In-app reminder banners still work while the app is open, and the app-icon badge count works on iOS 16.4+ once installed to the Home Screen. True background push on iOS requires the Web Push API with a push server (VAPID) - designed for, but intentionally left to v2.
