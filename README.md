# All-in-One CS

React Native app built with Expo, TypeScript, and Expo Router.

## Requirements

- Node.js LTS
- npm
- Expo Go on a device, or an Android/iOS simulator

## Get started

```bash
npm install
npm start
```

Scan the QR code with Expo Go, or use one of the platform commands:

```bash
npm run android
npm run ios
npm run web
```

The iOS simulator and native iOS builds require macOS. Android development
requires an Android emulator or a connected device.

## Available commands

- `npm start` - start the Expo development server
- `npm run android` - start the app on Android
- `npm run ios` - start the app on iOS
- `npm run web` - start the web version
- `npm run typecheck` - check TypeScript types

## Project structure

- `app/` - file-based routes and navigation layouts
- `components/` - shared UI components and color-scheme helpers
- `constants/` - shared app constants, including theme colors
- `assets/` - fonts, icons, and other static assets

Create a new `.tsx` file inside `app/` to add a route. Shared components,
business logic, and API integrations can be added in their respective folders
as the app grows.
