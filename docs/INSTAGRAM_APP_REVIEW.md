# Meta App Review — Instagram Messaging

Use this checklist when moving WhatsFlow Instagram integration from **Development** to **Live** mode on Meta.

## Prerequisites (before submitting)

1. **Business verification** — Meta Business Manager verified (recommended for messaging apps).
2. **Privacy Policy URL** — Public page describing how you store Instagram DMs, tokens, and lead data.
3. **Terms of Service URL** — Public page for your SaaS product.
4. **App icon & category** — Business / Messaging category in Meta Developer Console.
5. **Working demo video** — Screen recording showing:
   - Business connects Instagram in WhatsFlow Settings
   - Customer sends a DM on Instagram
   - Auto-reply appears in WhatsFlow Inbox
   - Optional: lead captured in Leads page

## Permissions to request

| Permission | Why WhatsFlow needs it |
|------------|------------------------|
| `instagram_basic` | Read IG business account username/profile |
| `instagram_manage_messages` | Receive and send Instagram DMs |
| `pages_messaging` | Messenger Platform webhook + Page token |
| `pages_show_list` | List Pages linked to the business |
| `pages_read_engagement` | Webhook verification and Page metadata |

Request only what you use. Remove unused permissions from the app dashboard.

## Webhook configuration (reviewers may test)

- **Callback URL:** `{APP_URL}/api/webhook/instagram/{userId}`
- **Verify token:** Same value the business enters in Settings → Instagram
- **Subscribed fields:** `messages`, `messaging_postbacks`
- **App secret:** Required in production — signature validation is enforced when configured

## Test instructions for Meta reviewers

Provide a test account in the App Review submission:

1. **WhatsFlow login:** `reviewer@yourdomain.com` / temporary password
2. **Connected Instagram:** `@your_test_ig_handle` (must accept DMs from reviewers)
3. **Steps:**
   - Log in to WhatsFlow portal
   - Open **Messages** — confirm Instagram DMs appear
   - Send a DM to the connected IG account from a personal Instagram account
   - Confirm auto-reply is delivered within 30 seconds
   - Open **Leads** if a lead-capture workflow is live

## Common rejection reasons

| Issue | Fix |
|-------|-----|
| Privacy policy missing or generic | Add Instagram-specific data handling section |
| Screencast doesn't show IG DM flow | Record full connect → receive → reply flow |
| Permission not used in app | Remove unused scopes or implement the feature |
| 24-hour window violations | Document that replies only work within Meta's messaging window |
| User data deletion | Document how businesses can disconnect Instagram in Settings |

## Production hardening (already in WhatsFlow)

- Webhook **HMAC signature** validation (`X-Hub-Signature-256`)
- **Duplicate webhook** deduplication by message ID
- **Retry with backoff** on Meta API 429/5xx errors
- **24-hour Instagram window** check before outbound sends
- **Integration error logging** visible in Dashboard → Delivery health

## After approval

1. Switch app mode to **Live** in Meta Developer Console.
2. Regenerate long-lived Page tokens if Meta requires re-authorization.
3. Re-test webhook subscription on production `APP_URL`.
4. Monitor **Delivery health** on the WhatsFlow Home dashboard for the first 48 hours.

## References

- [Instagram Messaging API](https://developers.facebook.com/docs/messenger-platform/instagram)
- [App Review documentation](https://developers.facebook.com/docs/app-review)
- Internal setup guide: [INSTAGRAM_SETUP.md](./INSTAGRAM_SETUP.md)
