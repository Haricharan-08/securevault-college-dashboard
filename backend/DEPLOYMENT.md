# Deployment checklist for SecureVault

GitHub Pages serves the dashboard; Render hosts the API at `https://securevault-account-api.onrender.com`. The dashboard is already connected to that URL. The Render service currently fails to start because `DATABASE_URL` is missing. Real account sign-in and SMS verification stay unavailable until `https://securevault-account-api.onrender.com/healthz` returns an `ok` status.

## Finish the private setup

1. Create or choose a managed PostgreSQL database and copy its connection URL privately. Do not paste it into chat or commit it to GitHub.
2. In the existing Render service’s private environment settings, add `DATABASE_URL`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`, `BOOTSTRAP_ADMIN_EMAIL`, and a unique `BOOTSTRAP_ADMIN_PASSWORD` (16–128 characters). Keep these values private.
3. Confirm the service retains the generated `API_DEVICE_TOKEN` and `RFID_HASH_KEY`, the correct `API_VAULT_DEVICE_ID`, and `CORS_ORIGIN=https://haricharan-08.github.io`. Never put the device token in the public website.
4. Save the private settings and redeploy. The service runs schema migrations and creates the first Seller Admin account before it starts. After the first successful start, remove `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD`.
5. Configure Twilio Verify SMS and its expiration and fraud controls before sending real codes. SMS and verification usage may incur charges.

## Using the dashboard

The demo buttons work without the API and use public sample credentials. Real account credentials should only be used after the backend status is online. Live account login, admin account provisioning, and phone verification are handled by the API. Vault OTP requests and verification are intended for the physical ESP32; this website does not unlock the vault. The read-only status relay is a separate setup and needs matching firmware.

## Evaluation limits

The free hosting setup is for evaluation only. The service can spin down while idle, and this setup is not appropriate for protecting valuables or claiming production-grade availability. Do not commit real `.env` files, database URLs, provider credentials, phone lists, passwords, RFID data, or device tokens.
