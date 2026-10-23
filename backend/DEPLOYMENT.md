# Deployment checklist for a demo

The root-level [render.yaml](../render.yaml) describes a Render web service for the API. It uses a free web instance and expects an external PostgreSQL URL. GitHub Pages remains a static demo until the dashboard is explicitly connected to the deployed API.

## Before creating the Render Blueprint

1. Create a PostgreSQL project. [Neon Free](https://neon.com/pricing) currently offers a no-cost tier with a 1 GB project limit; copy its pooled connection string privately. Do not create a Render Free Postgres database for persistent accounts: [Render's free-plan docs](https://render.com/docs/free) say its free Postgres databases expire after 30 days.
2. Create a Twilio Verify service with SMS enabled. Check current prices for the destination country and set account spend alerts before sending a real code.
3. Open Render, create a Blueprint from this GitHub repository, and use the repository's `render.yaml`.
4. At the private environment-variable prompt, enter the database URL, Twilio Account SID, Twilio Auth Token, Twilio Verify Service SID, initial admin email, and a unique 16–128 character admin password. Never put those values in GitHub or chat. Enter the admin email privately in Render's settings.
5. Render generates the device token and RFID HMAC key. Keep the device token private and configure the matching trusted firmware with it. Do not put it in the public dashboard.
6. Wait for the service to report healthy at `/healthz`. The start command migrates the schema and creates the initial Seller Admin account. Then remove both `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` from the service environment.

## Limits

Free hosting is for evaluation. Render's free web service can spin down when idle, and Neon Free has limited compute and storage. Do not use this demo deployment to protect valuables or claim production-grade availability. OTP usage has Twilio fees: [India outbound SMS](https://www.twilio.com/en-us/sms/pricing/in) is currently listed at $0.0832 per message segment, in addition to [Verify's fee for successful checks](https://www.twilio.com/en-us/verify/pricing) and any other applicable fees. Prices and terms can change.

The current dashboard UI is not connected to the API. After deployment, a separate frontend integration must use the Render HTTPS origin and keep session tokens in memory. Physical access decisions remain in ESP32 firmware; remote unlock is not provided.
