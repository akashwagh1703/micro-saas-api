/** Phase 0 — Meta setup checklist returned to the portal (keep in sync with docs/INSTAGRAM_SETUP.md). */
export const INSTAGRAM_SETUP_GUIDE = {
  title: 'Connect Instagram DMs',
  summary:
    'Link your Instagram Business account through Meta. Same Meta app as WhatsApp works — add the Instagram product.',
  meta_console_url: 'https://developers.facebook.com/apps',
  meta_business_url: 'https://business.facebook.com/settings',
  graph_explorer_url: 'https://developers.facebook.com/tools/explorer/',
  required_permissions: [
    'instagram_basic',
    'instagram_manage_messages',
    'pages_messaging',
    'pages_show_list',
    'pages_read_engagement',
  ],
  webhook_fields: ['messages', 'messaging_postbacks'],
  steps: [
    {
      id: 'meta_app',
      title: 'Create or open your Meta app',
      description: 'Add the Instagram product (Instagram API / Messaging). You can reuse your WhatsApp app.',
      link: 'https://developers.facebook.com/apps',
    },
    {
      id: 'link_ig_page',
      title: 'Link Instagram to a Facebook Page',
      description:
        'Your IG must be Business or Creator and connected to a Facebook Page in Meta Business Suite.',
      link: 'https://business.facebook.com/settings',
    },
    {
      id: 'page_token',
      title: 'Generate a Page access token',
      description:
        'Use Graph API Explorer or Business Suite. Token needs instagram_manage_messages and pages_messaging.',
      link: 'https://developers.facebook.com/tools/explorer/',
    },
    {
      id: 'paste_credentials',
      title: 'Paste credentials in AutoWave',
      description: 'Page access token, Page ID, verify token (any secret you choose), and app secret.',
    },
    {
      id: 'webhook',
      title: 'Add webhook in Meta',
      description:
        'Callback URL from AutoWave Settings. Use the same verify token. Subscribe to messages.',
    },
    {
      id: 'test',
      title: 'Test connection in AutoWave',
      description: 'Confirms your Page token and linked Instagram @username.',
    },
  ],
  app_review_note:
    'For production (customers outside test users), submit Meta App Review for instagram_manage_messages and pages_messaging.',
  app_review_doc: 'docs/INSTAGRAM_APP_REVIEW.md',
  messaging_window_hours: 24,
};
