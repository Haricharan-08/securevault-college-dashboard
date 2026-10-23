# SecureVault verification console

SecureVault is a single-site dashboard based on the college project presentation. It includes one sign-in page with separate User and Seller Admin views.

## Project demo logins

- User: `owner@securevault.demo` / `OwnerDemo!26`
- Seller Admin: `seller@securevault.demo` / `SellerDemo!26`

The Seller Admin can create user login details, register an RFID card ID, and deactivate/reactivate demo users. The admin view has no verification or unlock controls. New users receive a temporary password and must replace it at first sign-in. Users see the verification dashboard.

The role and account screens are a **browser demo**, not production authentication: demo passwords are public in this source, and created accounts exist only in the current browser tab and reset on refresh. Do not enter real passwords, RFID UIDs, PINs, or OTPs. See `hardware-integration.md` for the requirements before using real accounts or hardware.

## Physical hardware

The page includes a read-only hardware status mode and a Node.js WebSocket relay template (`relay-server.mjs`). The ESP32 must check RFID, PIN, OTP, and sensor state locally and control the servo. The website does not send unlock commands.

GitHub Pages hosts the static dashboard; account authentication, persistent user provisioning, and role enforcement need a secure server-side service and database. The included relay template handles read-only status with a separate dashboard token; it does not implement the demo sign-in or account management.

## Files

- `SecureVault-App.html` — standalone dashboard and role-based demo
- `relay-server.mjs` and `package.json` — read-only Node.js status relay template
- `hardware-integration.md` — hardware, relay, and production role-security notes