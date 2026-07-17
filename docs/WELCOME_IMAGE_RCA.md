# RCA: Welcome message with business image on WhatsApp

## Status (implemented)

**Phase 1** is shipped:

1. **Settings → Booking & business → Welcome image** — upload JPEG/PNG/WebP (max 5 MB). Stored on disk; public URL `${APP_URL}/api/public/branding/{userId}/{token}/welcome` (HTTPS required for WhatsApp).
2. **Workflow builder → Pick service step** — toggle welcome image; optional per-step HTTPS override URL.
3. **Runtime** — `pick_options` (appointment services) sends image + welcome text on WhatsApp:
   - ≤3 services: interactive buttons with **image header**
   - >3 services: image message with caption, then service list
4. **`send_message` nodes** — optional `media_url` / tenant `welcome_image_url` sends image with caption.

## Ops

- Set **`APP_URL`** to your public API base (e.g. `https://api.autowave.playltp.in`).
- On Render, use a **persistent disk** or object storage if you redeploy often — local `storage/branding` is wiped on ephemeral deploys unless mounted.

## Previous gaps (resolved)

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
