# SecureVault account and OTP API

This folder contains the Node.js/PostgreSQL API source for SecureVault. GitHub Pages serves the dashboard, which is connected to `https://securevault-account-api.onrender.com`; Render hosts the API separately. The service has been created, but deployment currently fails because `DATABASE_URL` is missing, so real sign-in and SMS verification remain unavailable until `/healthz` returns `ok`.

It provides persistent User and Seller Admin accounts, admin-only User provisioning/deactivation, server-enforced roles, phone verification, and SMS vault OTPs through Twilio Verify. Codes go to the registered phone and are never returned to the website. The ESP32 requests a code after its local RFID check, verifies the keypad code with the API, and remains the only component that decides whether the vault unlocks. This API has no unlock endpoint.

## Security behavior

- Passwords use salted scrypt hashes. Login returns a random eight-hour bearer session; only its SHA-256 digest is stored. Keep the token in frontend memory only, never localStorage/sessionStorage.
- Seller Admin can manage User accounts only; no route creates admins or controls the vault.
- RFID card IDs are normalized and stored as keyed HMAC digests, not plaintext.
- Twilio Verify generates and sends OTPs. The API stores challenge metadata only. Codes expire after five minutes, allow at most five attempts, and have a 60-second resend delay. Set the Twilio Verify code lifetime to five minutes or less and enable its fraud protections.
- The account holder must verify their phone before the device can request vault OTPs. CORS allows only the exact GitHub Pages origin.

## Routes

| Method and path | Access | Purpose |
| --- | --- | --- |
| GET /healthz | Public | Health/database check |
| POST /api/auth/login | Public | Email/password sign-in |
| GET /api/auth/me | Session | Current account |
| POST /api/auth/logout | Session | Revoke current session |
| POST /api/auth/change-password | Session | Change password and revoke sessions |
| POST /api/account/phone/send-verification | User | Send phone-verification SMS |
| POST /api/account/phone/verify | User | Verify phone challenge |
| GET /api/admin/users | Seller Admin | List Users |
| POST /api/admin/users | Seller Admin | Create User; temporary password returned once |
| PATCH /api/admin/users/:id/status | Seller Admin | Activate/deactivate User |
| POST /api/device/otp/request | Device bearer token | Send vault OTP SMS |
| POST /api/device/otp/verify | Device bearer token | Check code entered on device |

Device requests use `Authorization: Bearer <API_DEVICE_TOKEN>` and JSON fields `deviceId`, `userId`, `challengeId`, `code` as applicable. Never send raw RFID UIDs, PINs, keypad input, or Wi-Fi passwords to this service.

## Deploy

1. Choose a Node.js host and PostgreSQL database; set the service root to `backend/`.
2. Copy `.env.example` to private host settings. Set `DATABASE_URL`, `DATABASE_SSL`, `CORS_ORIGIN=https://haricharan-08.github.io`, `API_VAULT_DEVICE_ID`, `API_DEVICE_TOKEN`, and `RFID_HASH_KEY`. Generate separate random secrets of at least 32 bytes. Never commit real values.
3. Create a Twilio Verify service with SMS, short code expiry, and fraud controls. Add `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_VERIFY_SERVICE_SID` as private host secrets. Production refuses to start without all three.
4. Set first-admin `BOOTSTRAP_ADMIN_EMAIL` and a unique `BOOTSTRAP_ADMIN_PASSWORD` (16+ characters); run `npm run migrate` then `npm run create-admin`. Remove the bootstrap password afterward.
5. Use `npm start`, `NODE_ENV=production`, and host HTTPS. Set `TRUST_PROXY=1` only behind one trusted TLS proxy. Check `https://<api-host>/healthz`.
6. The public dashboard is integrated with the Render API URL; real accounts work only after its database, Twilio, and bootstrap admin settings are configured and /healthz is healthy. Matching ESP32 firmware and the read-only status relay remain separate hardware setup items.

Local setup: `npm install`, configure `.env`, then run `npm run migrate` and `npm start`. Without Twilio in development, OTP routes return 503; no code is printed in logs.

## Still required

PostgreSQL URL, Twilio Verify credentials, and a private bootstrap admin password still need to be configured. The Render API service and dashboard connection are already set up. ESP32 device-token/firmware integration is separate. Do not upload real `.env`, provider credentials, phone lists, passwords, or device tokens to GitHub.
