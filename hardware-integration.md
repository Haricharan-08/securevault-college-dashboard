# SecureVault live hardware integration

The GitHub Pages dashboard is a static front end. This project now includes a separate read-only Node.js WebSocket relay because the dashboard must receive device status over the internet. The ESP32 opens an outbound TLS WebSocket connection to the relay; the browser connects to the same relay using `wss://`. GitHub Pages does not run the relay service.

## Same-site User and Seller Admin roles

The sign-in page demonstrates both roles on the same SecureVault website. Role is assigned to the account; the user does not choose a role at login.

- **User:** opens the verification dashboard. Demo verification is simulated; live hardware is read-only status.
- **Seller Admin:** creates a user login, registers an RFID ID, and can deactivate/reactivate a demo user. The admin screen has no vault verification or unlock controls.
- A created user receives a generated temporary password and must replace it on first sign-in. The admin table does not show passwords.

These sign-ins and new accounts are demo-only. Demo account passwords are included in the public front-end, and accounts created by Seller Admin are kept only in JavaScript memory in that browser tab; refresh clears them. Do not use real passwords, RFID UIDs, PINs, or OTPs in this prototype.

A real role system must authenticate accounts on the server, store passwords using a slow salted password-hashing scheme, persist accounts in a protected database, and check the role on every protected operation. Seller Admin must have provisioning permissions only; the server must reject admin requests for user status, and the ESP32 must remain the only component that decides whether to unlock. The read-only relay in `relay-server.mjs` is not an account/authentication backend and uses a shared dashboard token, so it must not be treated as enforcing the demo roles. See [OWASP Authorization guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) and [OWASP Password Storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
## What the dashboard does

- Receives the ESP32's reported RFID, PIN, OTP, and motion/tamper results.
- Shows each check as waiting, pending, correct, incorrect, or alert, with the device's short explanation.
- Shows the box as locked, unlocked, offline, or in an alarm state.
- Uses a dashboard-only token. The website sends no PIN, card ID, OTP, unlock command, or servo command.
- Keeps the dashboard token in the current browser session only. It is not written to local storage.

The ESP32 must perform the checks and control the servo locally. Only send generic outcomes and non-sensitive messages to the relay; never transmit PINs, OTPs, RFID UIDs, Wi-Fi passwords, or raw keypad input.

## Parts and firmware

Use the ESP32, RFID reader, keypad, servo, and motion/tamper sensor listed in the project deck. Exact product models and wiring pins still need to be matched to the parts you buy. The device firmware should:

1. Verify RFID, PIN, OTP, and sensor state at the box. Keep the box locked on any failure, tamper alarm, reset, or loss of power.
2. Connect to the relay over TLS using a verified server certificate, then authenticate with the **device token**.
3. Send a status snapshot after each meaningful state change and periodically as a heartbeat. Include `event` only when a new event occurs; omit it on routine heartbeats so the activity list is not duplicated.
4. Reconnect with backoff when Wi-Fi or the relay is unavailable. The dashboard must never be the authority that unlocks the box.

ESP-IDF provides secure WebSocket/TLS support for ESP32 firmware; the exact firmware example depends on the final ESP32 board and chosen libraries. See the [ESP-IDF WebSocket documentation](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/protocols/esp_websocket_client.html).

## Deploy the relay

Deploy `relay-server.mjs` as a Node.js service on a host that provides HTTPS/WSS TLS termination. Configure the following environment values on the host. Do not commit real values to GitHub.

| Variable | Value |
| --- | --- |
| `PORT` | Set by the host, or `8080` for local use |
| `VAULT_DEVICE_ID` | One ID, for example `vault-01` |
| `DASHBOARD_TOKEN` | A private random value of at least 32 characters, used only in the dashboard |
| `DEVICE_TOKEN` | A different private random value of at least 32 characters, stored only in ESP32 firmware/configuration |
| `DASHBOARD_ORIGINS` | Exact HTTPS origin, e.g. `https://haricharan-08.github.io` |

Start command: `npm start`. The relay accepts WebSockets at `/ws` and has a health endpoint at `/healthz`. Use the full secure URL such as `wss://your-relay-host.example/ws` in the dashboard. Do not expose an insecure `ws://` endpoint to the public site.

Generate two different random tokens on a trusted computer; for example, Node.js can generate a 32-byte base64url value with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`. Store the dashboard token in your password manager and the device token in the device's private configuration. Rotate both if exposed.

The relay keeps the current device status and up to eight recent events in memory. A relay restart clears them. It accepts status reports only from the authenticated device; browser sessions are read-only.

## Message contract

On connection, the ESP32 sends this authentication frame (use the actual secret only in firmware, never in a public example):

```json
{"type":"auth","role":"device","deviceId":"vault-01","token":"<DEVICE_TOKEN>"}
```

After authentication, the device reports status like this:

```json
{
  "type":"status",
  "deviceId":"vault-01",
  "locked":true,
  "unlocked":false,
  "tamper":false,
  "failedAttempts":0,
  "checks":{
    "rfid":{"state":"correct","detail":"Registered card recognized."},
    "pin":{"state":"pending","detail":"Waiting for PIN entry at the box."},
    "otp":{"state":"neutral","detail":"Waiting for PIN verification."},
    "safety":{"state":"correct","detail":"Motion sensor clear."}
  },
  "event":{"kind":"success","message":"RFID check passed."}
}
```

Allowed check states: `neutral`, `pending`, `correct`, `incorrect`, `alert`. Event kinds: `info`, `success`, `failure`, `alert`. The relay adds its own receive timestamp. It will report `unlocked: true` only when the device says the box is unlocked, no tamper is active, and all four checks are correct.

The dashboard authenticates with `{ "type":"auth", "role":"dashboard", "deviceId":"vault-01", "token":"<DASHBOARD_TOKEN>" }`. It receives `auth_ok`, `snapshot`, `status`, `device_online`, and `device_offline` frames. The server rejects dashboard messages after authentication.

## Connect the dashboard

Open the [SecureVault dashboard](https://haricharan-08.github.io/securevault-college-dashboard/), enter the relay's `wss://…/ws` URL, `VAULT_DEVICE_ID`, and the dashboard-only token, then choose **Connect device**. Choose **Use demo** to return to the simulated project flow.

Until the relay is deployed and the device firmware is programmed with the matching protocol, the dashboard remains in demo mode and cannot display real sensor or lock state. Access from anywhere also depends on the ESP32 having working Wi-Fi/internet and the relay being online.
