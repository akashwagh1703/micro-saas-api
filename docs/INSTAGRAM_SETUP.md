# Instagram DM integration — Meta setup (Phase 0)

Complete this in [Meta for Developers](https://developers.facebook.com/apps) **before** connecting Instagram in WhatsFlow Settings.

## Prerequisites

1. **Instagram Business or Creator** account (not personal-only).
2. Instagram account **linked to a Facebook Page** ([Meta Business Suite](https://business.facebook.com/settings) → Accounts → Instagram accounts).
3. A **Meta app** — you can use the same app as WhatsApp Cloud API.

## Step 1 — Add Instagram to your Meta app

1. Open [Meta Developer Console](https://developers.facebook.com/apps) → your app.
2. **Add product** → **Instagram** (Instagram API / Instagram Messaging).
3. Under **Instagram** → **API setup**, confirm the linked Instagram professional account appears.

## Step 2 — Facebook Page & permissions

1. Note your **Facebook Page ID** (Page Settings → About, or Graph API Explorer).
2. Generate a **Page access token** with:
   - `instagram_basic`
   - `instagram_manage_messages`
   - `pages_messaging`
   - `pages_show_list`
   - `pages_read_engagement`
3. Use [Graph API Explorer](https://developers.facebook.com/tools/explorer/) or Meta Business Suite to create a **long-lived Page token**.

## Step 3 — Webhook (after Phase 3 deploy)

WhatsFlow webhook URL per account:

```
{APP_URL}/api/webhook/instagram/{userId}
```

Incoming Instagram DMs are processed by the same workflow queue as WhatsApp.

- **Verify:** `GET /api/webhook/instagram/{userId}?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...`
- **Receive:** `POST /api/webhook/instagram/{userId}` — Meta `instagram` or `page` object with `messaging[]`

Subscribe to **messages** (and optionally **messaging_postbacks**) on your Page / Instagram product in Meta Developer Console.

Also add **App Secret** in WhatsFlow for signature verification.

## Step 4 — Connect in WhatsFlow portal

1. **Settings → Instagram**
2. Paste **Page access token**, **Page ID**, **Verify token**, **App secret**
3. Click **Test connection** — we fetch your `@username` and IG business account id
4. Add the webhook URL in Meta and verify — incoming DMs will appear in Messages

## Step 5 — App Review (production)

For customers outside your Meta app test users, submit **App Review** for:

- `instagram_manage_messages`
- `pages_messaging`

Until approved, only test users / roles on the Meta app can use Instagram DMs.

## Outbound replies (Phase 4)

WhatsFlow sends Instagram replies via the Graph API using your **Page access token**:

- Portal **Messages** → manual reply on Instagram threads
- Workflow **Send message** step → routes by conversation channel (WhatsApp or Instagram)

Meta enforces a **24-hour messaging window** after the customer's last message. Replies outside that window may fail until they message again.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| No Instagram Business account on Page | Link IG to Page in Business Suite |
| Test connection fails | Token must be a **Page** token, not User token |
| Webhook verify fails | Verify token must match exactly in Meta and WhatsFlow |
| DMs not arriving | Webhook Phase 3 must be deployed; subscribe `messages` field |

## Environment

Uses the same Graph API version as WhatsApp:

```env
WHATSAPP_GRAPH_VERSION=v21.0
APP_URL=https://your-api.onrender.com
```
