// Main payload interface for WhatsApp Business API
export interface WhatsAppMessagePayload {
  messaging_product: string;
  to: string;
  type: string;
  interactive: InteractiveMessage;
}

// Interactive message structure
export interface InteractiveMessage {
  type: 'button' | 'list' | 'product';
  header?: MessageHeader;
  body: MessageBody;
  footer?: MessageFooter;
  action: QuickReplyAction | ListAction | FlowButtonAction;
}

// Header with optional media
export interface MessageHeader {
  type: 'text' | 'image' | 'document' | 'video';
  text?: string;
  image?: { link: string };
  document?: { link: string };
  video?: { link: string };
}

// Message body
export interface MessageBody {
  text: string;
}

// Message footer
export interface MessageFooter {
  text: string;
}

// Quick reply buttons action (max 3)
export interface QuickReplyAction {
  buttons: Array<{
    type: 'reply';
    reply: { id: string; title: string };
  }>;
}

// List message action (max 10)
export interface ListAction {
  button: string;
  sections: Array<{
    title?: string;
    rows: Array<{
      id: string;
      title: string;
      description?: string;
    }>;
  }>;
}

// Flow button action (single button)
export interface FlowButtonAction {
  button: string;
  url: string;
}

// API response structures
export interface WhatsAppApiResponse {
  messages: Array<{ id: string }>;
  contacts: Array<{ input: string; wa_id: string }>;
}

export interface WhatsAppApiError {
  error: {
    message: string;
    type: string;
    code: number;
    error_data?: Record<string, any>;
  };
}
