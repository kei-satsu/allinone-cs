# All-in-One CS

React Native app built with Expo, TypeScript, and Expo Router.

## Requirements

- Node.js LTS
- npm
- Expo Go on a device, or an Android/iOS simulator

This project uses Expo SDK 58. Use an SDK 58-compatible Expo Go build or a
development build to run it on a device.

## Get started

```bash
npm install
npm start
```

## Sign-in and branch assignment

Set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` in
`.env.local`. The project URL is already provided; paste the public `anon` key
(or publishable key) from the Supabase project's API settings. These are
client-side public credentials; never put the Supabase service-role key in the
Expo app.

Sign in with an existing Supabase email and password account. The app reads
the assigned branch from `app_metadata.branch`, then `user_metadata.branch`,
and defaults to `MDY` when no branch is set. Accounts with the `admin` role or
`ADMIN` branch can select MDY or YGN during parcel intake; other accounts are
restricted to their assigned branch. Authentication sessions are persisted on
the device.

## Parcel intake API

Set `EXPO_PUBLIC_API_BASE_URL` in `.env.local` to the base URL of the existing
All-in-One backend (for example, `https://your-domain.example`). This variable
is currently blank and must be filled in before using intake uploads. For a
physical device on a local network, use the development computer's LAN address
instead of `localhost`.

The mobile app calls the backend's `/api/orders`, `/api/upload-r2`, and
`/api/telegram` routes. Configure the backend-only variables listed in
`.env.backend.example` in the existing Next.js backend's `.env.local`, not in
this Expo app. Keep Supabase service-role, Cloudflare R2, and Telegram
credentials on the backend; never put those secrets in Expo public environment
variables.
Offline intake records and their photos are kept in the device's local SQLite
database and documents directory until they are uploaded.

## Parcel lookup and local voucher printing

The Parcel Lookup shortcut searches the signed-in branch's parcel records,
scans parcel barcodes, shows parcel details, and creates parcel or manual
vouchers. Vouchers can be printed through the phone's system print dialog or
Windows LAN bridge, shared as a 4 × 6 PDF, or saved and shared as an image.
The voucher uses the existing All-in-One 4 × 6 layout, including the office
details, sender/receiver sections, QR reference, payment display, and remark.

## Stock check

Open **Explore → Stock Check** to see parcels assigned to the signed-in branch
or arriving there by transit. Search by item ID, barcode, sender, receiver, or
phone; filter by status; scan a barcode; and mark a parcel checked for today.
Checked parcels can be unchecked to return them to the stock list. The screen
also supports pull-to-refresh and viewing parcel photos.

For printing to a Windows-connected LAN printer:

1. Install and run the app in `windows-print-bridge/` on a Windows computer that
   has the printer driver installed. Its setup guide is in
   `windows-print-bridge/README.md`.
2. Connect the phone and Windows computer to the same trusted private Wi-Fi.
3. From Parcel Lookup, scan the QR shown by the Windows Print Bridge and choose
   a printer. The bridge listens on port 4318; allow it through Windows Firewall
   on **Private networks only**.

The LAN bridge uses HTTP on the private network and a QR-paired token. Do not
expose port 4318 to the internet or pair while using public Wi-Fi. Native
network-permission settings were added for LAN printing; create a new
development/production build for those settings to take effect. Expo Go may
not include the generated native network configuration.

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
- `npm run lint` - run Expo lint

## OTA updates with EAS Update

EAS Update can deliver JavaScript, styling, and asset changes without a new
store release. Changes to native dependencies, permissions, native config, or
the Expo SDK still require a new EAS Build. This project uses separate
`preview` and `production` update channels and the fingerprint runtime policy
to avoid sending an update to an incompatible native build.

### One-time setup

1. Sign in to the Expo account that owns this project:

   ```bash
   npx eas-cli@latest login
   npx eas-cli@latest whoami
   ```

2. In the Expo dashboard, open this project's **Environment variables** and
   add the following client-side values to both the `preview` and `production`
   environments:

   - `EXPO_PUBLIC_API_BASE_URL`
   - `EXPO_PUBLIC_SUPABASE_URL`
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY`

   These values are embedded in the app bundle and are not private secrets.
   Never add the Supabase service-role key, backend credentials, or other
   server-only secrets to the mobile app's EAS environments.

3. Build and install a preview APK. This first build is required because the
   already-installed app does not contain `expo-updates`:

   ```bash
   npx eas-cli@latest build --profile preview --platform android
   ```

   Install the APK from the completed EAS build page and test sign-in,
   parcel uploads, and other critical flows before releasing to production.

4. Build the production Android app once, then distribute it through the
   existing release method. The default Android production artifact is an
   app bundle for Google Play:

   ```bash
   npx eas-cli@latest build --profile production --platform android
   ```

   If production is distributed as a directly installed APK instead of through
   Google Play, set `distribution` to `internal` and `android.buildType` to
   `apk` in the `production` profile before building. Before replacing the
   existing app with this first EAS build, confirm its Android signing key is
   compatible with the installed version. Uninstalling an app to replace it
   with a differently signed build deletes its local data, so upload any
   pending offline intake records first.

### Publishing later JavaScript and asset updates

Publish to preview first:

```bash
npx eas-cli@latest update --channel preview --environment preview --message "Describe the change"
```

After testing the preview build, publish the same source to production:

```bash
npx eas-cli@latest update --channel production --environment production --message "Describe the change"
```

Release builds check for updates when launched. The update downloads in the
background and is normally applied after closing and reopening the app. If an
update requires a native dependency, permission, config-plugin, or SDK change,
create and distribute a new build instead of publishing an OTA update.

## Project structure

- `src/app/` - file-based routes and navigation layouts
- `components/` - shared UI components and color-scheme helpers
- `constants/` - shared app constants, including theme colors
- `assets/` - fonts, icons, and other static assets

Create a new `.tsx` file inside `src/app/` to add a route. Shared components,
business logic, and API integrations can be added in their respective folders
as the app grows.
