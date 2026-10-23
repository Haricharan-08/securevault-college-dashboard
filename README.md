# SecureVault verification console

SecureVault is a college project dashboard demo with separate User and Seller Admin views.

## Demo logins

- User: `owner@securevault.demo` / `OwnerDemo!26`
- Seller Admin: `seller@securevault.demo` / `SellerDemo!26`

These demo credentials are public. Demo accounts and role handling run in the browser and are not production authentication. Do not enter real passwords, RFID UIDs, PINs, or OTPs.

## Backend API source

The Node.js API, database schema, environment template, and setup guide are in [backend/](backend/). It contains account provisioning, password login, phone OTP, session, and read-only vault-status endpoints. It is source code only: GitHub Pages cannot run this server, and the API is not live until deployed with PostgreSQL and configured SMS Verify credentials. The website currently remains a demo and is not connected to this API.

## Hardware and security

The website does not send remote unlock commands. Physical access checks and actuator control must remain in the device firmware. See [hardware-integration.md](hardware-integration.md) and [backend/README.md](backend/README.md) for integration and deployment requirements.
