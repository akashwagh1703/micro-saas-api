// Incoming webhook payload
export interface WhatsAppWebhookPayload {
  object: string;
  entry: WebhookEntry[];
}

export interface WebhookEntry {
  id: string;
  changes: WebhookChange[];
}

export interface WebhookChange {
  field: string;
  value: WebhookValue;
}

export interface WebhookValue {
  messaging_product: string;
  metadata?: {
    display_phone_number: string;
    phone_number_id: string;
  };
  messages?: WebhookMessage[];
  statuses?: MessageStatus[];
  errors?: WebhookError[];
}

// Message structures
export interface WebhookMessage {
  from: string;
  id: string;
  timestamp: string;
  type: 'text' | 'interactive' | 'image' | 'document' | 'audio' | 'video';
  text?: { body: string };
  interactive?: InteractiveReply;
  image?: MediaMessage;
  document?: MediaMessage;
  audio?: MediaMessage;
  video?: MediaMessage;
}

// Interactive reply (button or list)
export interface InteractiveReply {
  type: 'button_reply' | 'list_reply';
  button_reply?: {
    id: string;
    title: string;
  };
  list_reply?: {
    id: string;
    title: string;
    description: string;
  };
}

// Media message
export interface MediaMessage {
  mime_type: string;
  sha256: string;
  id: string;
  caption?: string;
}

// Message status
export interface MessageStatus {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;
  recipient_id?: string;
  errors?: Array<{ code: number; title: string; message: string }>;
}

// Webhook error
export interface WebhookError {
  code: number;
  title: string;
  message: string;
  error_data?: {
    details: string;
  };
}

// Webhook verification challenge
export interface WebhookVerificationRequest {
  hub: {
    mode: string;
    challenge: string;
    verify_token: string;
  };
}
