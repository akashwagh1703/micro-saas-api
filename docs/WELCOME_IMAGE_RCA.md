# RCA: Welcome message with business image on WhatsApp

## Current behavior

- **Trigger / welcome flows** use the `send_message` node (`SendMessageNodeExecutor`), which only enqueues **plain text** via `enqueueSendMessage`.
- **WhatsApp media** is supported at the inbox layer (`InboxService` upload + send with `mediaId`) for agent uploads, not wired into workflow welcome nodes.
- **Business branding** today: `business_name`, `business_description`, appointment service labels — **no** `welcome_image_url` setting in settings API.

## Why images do not appear on welcome

| Layer | Gap |
|--------|-----|
| Portal / settings | No field to store welcome hero image URL or media handle |
| Workflow template | Welcome template is text-only `send_message` |
| Send path | `send_message` executor does not call `sendImage` / template header image |
| WhatsApp Cloud API | Image messages need public HTTPS URL or uploaded `media_id` |

## Recommended feature (phased)

### Phase 1 — Settings + URL image

1. Add setting keys: `welcome_image_url` (HTTPS), optional `welcome_message` (already in templates as node data).
2. Extend `SendMessageNodeExecutor`:
   - If `data.media_url` or setting `welcome_image_url` is set → `inbox.sendMediaMessage` (or new helper) with caption = substituted text.
   - Else → current text-only path.
3. Portal: **Settings → Branding** upload to your CDN/S3; save URL in settings.

### Phase 2 — Per–business-type defaults

- Store default welcome images under `content/welcome/{business_category}.jpg` on CDN.
- `trigger` node or first `send_message` pulls image by `business_category` when tenant has no custom URL.

### Phase 3 — Interactive welcome

- Optional `interactive_message` node with image header (WhatsApp interactive messages support header image when API allows).

## Security / ops

- Image URL must be **HTTPS**, allowlisted host optional.
- Max size per Meta limits (~5 MB image).
- Do not embed secrets in image URLs.

## Quick win without code (today)

- Use WhatsApp **profile photo** and **business description** in Meta Business Manager for brand presence; keep workflow welcome as text until Phase 1 ships.
