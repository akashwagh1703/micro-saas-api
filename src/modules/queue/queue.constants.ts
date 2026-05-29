export const QUEUE_PROCESS_INCOMING = 'process-incoming-message';
export const QUEUE_EXECUTE_WORKFLOW = 'execute-workflow';
export const QUEUE_SEND_MESSAGE = 'send-whatsapp-message';

export const ALL_QUEUES = [
  QUEUE_PROCESS_INCOMING,
  QUEUE_EXECUTE_WORKFLOW,
  QUEUE_SEND_MESSAGE,
];

export interface SendMessageJob {
  userId: number;
  conversationId: number | null;
  content: string;
}
