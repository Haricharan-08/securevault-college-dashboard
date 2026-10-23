# SecureVault verification console

SecureVault is a college project dashboard demo with separate User and Seller Admin views.

## Demo logins

- User: `owner@securevault.demo` / `OwnerDemo!26`
- Seller Admin: `seller@securevault.demo` / `SellerDemo!26`

These demo credentials are public. Demo accounts and role handling run in the browser and are not production authentication. Do not enter real passwords, RFID UIDs, PINs, or OTPs.

## Backend API

The Node.js API source is in [backend/](backend/). A [Render deployment blueprint](render.yaml) and [deployment guide](backend/DEPLOYMENT.md) are included. The API is not deployed or connected to this dashboard yet; GitHub Pages only hosts the static demo. The free hosting configuration is for evaluation only and is not suitable for protecting valuables.

## Hardware and security

The website does not send remote unlock commands. Physical access checks and actuator control must remain in the device firmware. See [hardware-integration.md](hardware-integration.md) and the [backend setup guide](backend/README.md) for integration requirements.
