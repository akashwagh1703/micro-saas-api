import {
  Activity,
  Contact,
  Conversation,
  ExecutionLog,
  InstagramAccount,
  Lead,
  Message,
  User,
  Workflow,
  WorkflowExecution,
} from '@prisma/client';

/** Formats a date the way Laravel serializes Eloquent timestamps (ISO 8601, or null). */
function dt(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

export function serializeUser(u: User, options?: { isSuperAdmin?: boolean }) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    email_verified_at: dt(u.emailVerifiedAt),
    created_at: dt(u.createdAt),
    updated_at: dt(u.updatedAt),
    is_super_admin: !!options?.isSuperAdmin,
  };
}

export function serializeContact(c: Contact) {
  return {
    id: c.id,
    user_id: c.userId,
    channel: c.channel,
    name: c.name,
    phone: c.phone,
    instagram_user_id: c.instagramUserId,
    username: c.username,
    email: c.email,
    tags: c.tags ?? null,
    notes: c.notes,
    last_message_at: dt(c.lastMessageAt),
    created_at: dt(c.createdAt),
    updated_at: dt(c.updatedAt),
  };
}

export function serializeMessage(m: Message) {
  return {
    id: m.id,
    user_id: m.userId,
    conversation_id: m.conversationId,
    contact_id: m.contactId,
    channel: m.channel,
    direction: m.direction,
    content: m.content,
    wa_message_id: m.waMessageId,
    external_message_id: m.externalMessageId,
    status: m.status,
    metadata: m.metadata ?? null,
    created_at: dt(m.createdAt),
    updated_at: dt(m.updatedAt),
  };
}

export function serializeConversation(c: Conversation & { contact?: Contact | null }) {
  return {
    id: c.id,
    user_id: c.userId,
    contact_id: c.contactId,
    channel: c.channel,
    whats_app_account_id: c.whatsAppAccountId,
    instagram_account_id: c.instagramAccountId,
    unread_count: c.unreadCount,
    last_message_at: dt(c.lastMessageAt),
    created_at: dt(c.createdAt),
    updated_at: dt(c.updatedAt),
    ...(c.contact !== undefined ? { contact: c.contact ? serializeContact(c.contact) : null } : {}),
  };
}

export function serializeInstagramAccount(a: InstagramAccount) {
  return {
    id: a.id,
    user_id: a.userId,
    instagram_user_id: a.instagramUserId,
    page_id: a.pageId,
    username: a.username,
    display_name: a.displayName,
    is_connected: a.isConnected,
    connected_at: dt(a.connectedAt),
    has_access_token: !!a.accessToken,
    has_verify_token: !!a.verifyToken,
    has_app_secret: !!a.appSecret,
    created_at: dt(a.createdAt),
    updated_at: dt(a.updatedAt),
  };
}

export function serializeWorkflow(w: Workflow) {
  return {
    id: w.id,
    user_id: w.userId,
    name: w.name,
    description: w.description,
    status: w.status,
    is_active: w.isActive,
    trigger_type: w.triggerType,
    source_template: w.sourceTemplate,
    business_category: w.businessCategory,
    use_case: w.useCase,
    is_archived: w.isArchived,
    definition: w.definition ?? null,
    created_at: dt(w.createdAt),
    updated_at: dt(w.updatedAt),
  };
}

export function serializeExecutionLog(l: ExecutionLog) {
  return {
    id: l.id,
    workflow_execution_id: l.workflowExecutionId,
    node_id: l.nodeId,
    node_type: l.nodeType,
    status: l.status,
    input: l.input ?? null,
    output: l.output ?? null,
    error_message: l.errorMessage,
    duration_ms: l.durationMs,
    created_at: dt(l.createdAt),
    updated_at: dt(l.updatedAt),
  };
}

export function serializeWorkflowExecution(
  e: WorkflowExecution & { logs?: ExecutionLog[] },
) {
  return {
    id: e.id,
    user_id: e.userId,
    workflow_id: e.workflowId,
    contact_id: e.contactId,
    conversation_id: e.conversationId,
    message_id: e.messageId,
    status: e.status,
    context: e.context ?? null,
    error_message: e.errorMessage,
    started_at: dt(e.startedAt),
    completed_at: dt(e.completedAt),
    created_at: dt(e.createdAt),
    updated_at: dt(e.updatedAt),
    ...(e.logs !== undefined ? { logs: e.logs.map(serializeExecutionLog) } : {}),
  };
}

export function serializeActivity(a: Activity) {
  return {
    id: a.id,
    user_id: a.userId,
    type: a.type,
    title: a.title,
    description: a.description,
    metadata: a.metadata ?? null,
    created_at: dt(a.createdAt),
    updated_at: dt(a.updatedAt),
  };
}

export function serializeLead(l: Lead) {
  return {
    id: l.id,
    user_id: l.userId,
    channel: l.channel,
    status: l.status,
    contact_id: l.contactId,
    conversation_id: l.conversationId,
    workflow_id: l.workflowId,
    execution_id: l.executionId,
    name: l.name,
    phone: l.phone,
    username: l.username,
    source_message: l.sourceMessage,
    collected: l.collected ?? null,
    notes: l.notes,
    created_at: dt(l.createdAt),
    updated_at: dt(l.updatedAt),
  };
}
