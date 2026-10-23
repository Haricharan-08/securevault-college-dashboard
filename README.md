# SecureVault verification console

SecureVault is a college project dashboard demo with separate User and Seller Admin views.

## Demo logins

- User: `owner@securevault.demo` / `OwnerDemo!26`
- Seller Admin: `seller@securevault.demo` / `SellerDemo!26`

These demo credentials are public. Demo accounts run in the browser and are not production authentication. The published dashboard also connects to the live API when its status is online. Do not enter real credentials while the backend is unavailable.

## Backend API

The Node.js API source is in [backend/](backend/). A [Render deployment blueprint](render.yaml) and [deployment guide](backend/DEPLOYMENT.md) are included. The public dashboard now connects to `https://securevault-account-api.onrender.com`. The Render service has been created, but it is not healthy: deployment currently fails because `DATABASE_URL` is missing. Configure the PostgreSQL URL, private Twilio Verify credentials, and bootstrap admin credentials in Render’s private environment settings. Do not commit secrets. Real account login and SMS verification remain unavailable until `https://securevault-account-api.onrender.com/healthz` returns an `ok` status.

## Hardware and security

The website does not send remote unlock commands. Physical access checks and actuator control must remain in the device firmware. See [hardware-integration.md](hardware-integration.md) and the [backend setup guide](backend/README.md) for integration requirements. The free hosting configuration is for evaluation and is not suitable for protecting valuables.
