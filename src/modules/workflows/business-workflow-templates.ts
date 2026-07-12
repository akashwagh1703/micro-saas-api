/**
 * Phase 2: curated workflow templates for specific business × use-case pairs.
 * Used only by the guided generate flow (category "guided") — not listed as
 * generic starter templates in the portal.
 */

import { findTemplate, linearFlow, WorkflowTemplate } from './workflow-templates';
import { buildSaveLeadApiPlaceholder } from '../leads/lead-api.config';
import type { SchedulingVertical } from '../../platform/appointment-services';
import { getVerticalAvailabilityDefaults } from '../availability/availability-vertical-defaults';

const DEFAULT_AI = {
  provider: 'openrouter',
  model: 'openai/gpt-4o-mini',
  temperature: 0.6,
  max_tokens: 250,
  fallback_message:
    'Hello! Thanks for reaching out to {{business_name}}. Tap the buttons in our next message to book your appointment — it only takes a moment.',
};


function aiNode(id: string, y: number, label: string, summary: string, prompt: string) {
  return {
    id,
    type: 'ai',
    y,
    data: { label, summary, prompt, ...DEFAULT_AI },
  };
}

function sendNode(id: string, y: number, label: string, message: string, summary?: string) {
  return {
    id,
    type: 'send_message',
    y,
    data: { label, summary: summary ?? 'Sends WhatsApp reply', message },
  };
}

function triggerNode(y = 80, channel: 'both' | 'whatsapp' | 'instagram' = 'both') {
  const summaries: Record<string, string> = {
    both: 'WhatsApp or Instagram DMs',
    whatsapp: 'WhatsApp messages only',
    instagram: 'Instagram DMs only',
  };
  return {
    id: 'trigger-1',
    type: 'trigger',
    y,
    data: {
      label: 'Message Received',
      summary: summaries[channel] ?? summaries.both,
      channel,
    },
  };
}

function collectNode(
  id: string,
  y: number,
  field: string,
  label: string,
  question: string,
) {
  return {
    id,
    type: 'collect_input',
    y,
    data: {
      label,
      summary: `Ask: ${question.slice(0, 50)}${question.length > 50 ? '…' : ''}`,
      field,
      question,
    },
  };
}

function pickAppointmentServicesNode(
  id: string,
  y: number,
  label: string,
  header: string,
  body: string,
  footer?: string,
) {
  return {
    id,
    type: 'pick_options',
    y,
    data: {
      label,
      summary: 'Booking services picker (from Settings)',
      field: 'service_type',
      options_source: 'appointment_services',
      header,
      body,
      footer,
    },
  };
}

function pickSalonServicesNode(
  id: string,
  y: number,
  label: string,
  header: string,
  body: string,
  footer?: string,
) {
  return pickAppointmentServicesNode(id, y, label, header, body, footer);
}

function pickOptionsNode(
  id: string,
  y: number,
  label: string,
  field: string,
  header: string,
  body: string,
  options: { text: string; description?: string; value: string }[],
  footer?: string,
) {
  return {
    id,
    type: 'pick_options',
    y,
    data: {
      label,
      summary: `Tap-to-pick: ${label}`,
      field,
      header,
      body,
      footer,
      options,
    },
  };
}

function pickDateNode(id: string, y: number, label: string, body: string, header = 'Pick a day') {
  return {
    id,
    type: 'pick_options',
    y,
    data: {
      label,
      summary: 'Today / Tomorrow quick-pick buttons',
      field: 'preferred_date',
      mode: 'date_quick_pick',
      header,
      body,
    },
  };
}

function listResourcesNode(
  id: string,
  y: number,
  label: string,
  body: string,
  header = 'Choose your stylist',
) {
  return {
    id,
    type: 'list_resources',
    y,
    data: {
      label,
      summary: 'Shows barbers/stylists as a WhatsApp picker',
      header,
      body,
    },
  };
}

function listSlotsNode(
  id: string,
  y: number,
  label: string,
  body: string,
  dateField = 'preferred_date',
) {
  return {
    id,
    type: 'list_slots',
    y,
    data: {
      label,
      summary: 'Shows available appointment slots',
      body,
      date_field: dateField,
    },
  };
}

function bookSlotNode(id: string, y: number, label: string, confirmMessage: string) {
  return {
    id,
    type: 'book_slot',
    y,
    data: {
      label,
      summary: 'Books the selected slot and confirms to customer',
      confirm_message: confirmMessage,
      conflict_message:
        'Sorry, that slot was just taken. Tap another time from the buttons below.',
    },
  };
}

function leadCaptureTail(
  yStart: number,
  confirmMessage: string,
  options?: { collectedFields?: string[]; notes?: string; channel?: 'whatsapp' | 'instagram' | 'both' },
) {
  const collectedFields = options?.collectedFields ?? [];
  const notes = options?.notes;
  const channel = options?.channel ?? 'whatsapp';
  return [
    {
      id: 'save-lead-1',
      type: 'save_lead',
      y: yStart,
      data: {
        label: 'Save Lead',
        summary: 'Saves lead to AutoWave Leads',
        notes,
        collected_fields: collectedFields,
        api: buildSaveLeadApiPlaceholder(collectedFields, notes, channel),
      },
    },
    sendNode(
      'send-confirm',
      yStart + 120,
      'Lead Confirmation',
      confirmMessage,
      'Confirms lead was received',
    ),
  ];
}

function leadSaveOnly(
  yStart: number,
  options?: { collectedFields?: string[]; notes?: string; channel?: 'whatsapp' | 'instagram' | 'both' },
) {
  const collectedFields = options?.collectedFields ?? [];
  const notes = options?.notes;
  const channel = options?.channel ?? 'whatsapp';
  return [
    {
      id: 'save-lead-1',
      type: 'save_lead',
      y: yStart,
      data: {
        label: 'Save Lead',
        summary: 'Saves booking to AutoWave Leads',
        notes,
        collected_fields: collectedFields,
        api: buildSaveLeadApiPlaceholder(collectedFields, notes, channel),
      },
    },
  ];
}

const LIVE_APPOINTMENT_AI = {
  welcome: (role: string) =>
    `You are the WhatsApp booking assistant for *{{business_name}}* (${role}). ` +
    `{{contact_name}} just messaged: "{{message}}". ` +
    `Reply in 2-3 warm, professional lines. Greet them by name if available. ` +
    `Explain they can book in a few taps — service, day, and time buttons are coming next. ` +
    `Do NOT ask them to type answers. Use *bold* for the business name.`,
  serviceAck:
    `You are booking for *{{business_name}}*. {{contact_name}} chose *{{service_type}}*. ` +
    `Reply in 1-2 friendly lines confirming their choice. ` +
    `Tell them to tap *Today* or *Tomorrow* on the next message to pick a date. No typed replies.`,
  thankYou:
    `Write a cheerful booking confirmation for *{{business_name}}*. ` +
    `Customer: {{contact_name}}. Service: *{{service_type}}*. ` +
    `With: *{{resource_name}}*. When: *{{booking_time}}*. ` +
    `Use 3-4 short lines with one emoji. Bold the key details. End with "See you then!"`,
};

interface LiveAppointmentMeta {
  slug: string;
  name: string;
  description: string;
  role: string;
  emoji: string;
  serviceHeader: string;
  serviceBody: string;
  resourceHeader: string;
  resourceBody: string;
  slotsBody: string;
  bookConfirm: string;
  leadNotes: string;
}

const LIVE_APPOINTMENT_BY_VERTICAL: Record<SchedulingVertical, LiveAppointmentMeta> = {
  salon: {
    slug: 'salon-appointment',
    name: 'Salon Appointment Booking',
    description:
      'AI welcome + button booking: services, date, stylist, and live slot confirmation.',
    role: 'salon/beauty',
    emoji: '✂️',
    serviceHeader: 'Book at {{business_name}} ✂️',
    serviceBody: 'Hi {{contact_name}}! Choose the service you would like:',
    resourceHeader: 'Pick your stylist',
    resourceBody: 'Who would you like on {{preferred_date}}?',
    slotsBody: 'Available times with {{resource_name}} on {{preferred_date}}:',
    bookConfirm:
      '✅ Appointment confirmed!\n\nStylist: {{resource_name}}\nWhen: {{booking_time}}\nService: {{service_type}}',
    leadNotes: 'Salon appointment booking from WhatsApp',
  },
  clinic: {
    slug: 'clinic-appointment',
    name: 'Clinic Appointment Booking',
    description: 'AI welcome + button booking: service, date, doctor, and slot confirmation.',
    role: 'clinic/doctor',
    emoji: '🏥',
    serviceHeader: '{{business_name}} 🏥',
    serviceBody: 'Hi {{contact_name}}! Select the type of visit you need:',
    resourceHeader: 'Choose your doctor',
    resourceBody: 'Select a doctor for {{preferred_date}}:',
    slotsBody: 'Pick a time with {{resource_name}} on {{preferred_date}}:',
    bookConfirm:
      '✅ Appointment confirmed!\n\nDoctor: {{resource_name}}\nWhen: {{booking_time}}\nVisit: {{service_type}}',
    leadNotes: 'Clinic appointment booking from WhatsApp',
  },
  coaching: {
    slug: 'coaching-appointment',
    name: 'Coaching Demo Class Booking',
    description: 'AI welcome + button booking for demo classes and counselling sessions.',
    role: 'coaching institute',
    emoji: '🎓',
    serviceHeader: '{{business_name}} 🎓',
    serviceBody: 'Hi {{contact_name}}! What would you like to book?',
    resourceHeader: 'Choose your counsellor',
    resourceBody: 'Who will you meet on {{preferred_date}}?',
    slotsBody: 'Choose a slot with {{resource_name}} on {{preferred_date}}:',
    bookConfirm:
      '✅ Session confirmed!\n\nCounsellor: {{resource_name}}\nWhen: {{booking_time}}\nSession: {{service_type}}',
    leadNotes: 'Coaching demo/session booking from WhatsApp',
  },
  real_estate: {
    slug: 'real-estate-appointment',
    name: 'Real Estate Site Visit Booking',
    description: 'AI welcome + button booking for site visits and property consultations.',
    role: 'real estate agency',
    emoji: '🏠',
    serviceHeader: '{{business_name}} 🏠',
    serviceBody: 'Hi {{contact_name}}! Select the visit type you need:',
    resourceHeader: 'Choose your agent',
    resourceBody: 'Which agent should meet you on {{preferred_date}}?',
    slotsBody: 'Available times with {{resource_name}} on {{preferred_date}}:',
    bookConfirm:
      '✅ Visit confirmed!\n\nAgent: {{resource_name}}\nWhen: {{booking_time}}\nVisit: {{service_type}}',
    leadNotes: 'Real estate site visit booking from WhatsApp',
  },
  ca_accountant: {
    slug: 'ca-accountant-appointment',
    name: 'CA Consultation Booking',
    description: 'AI welcome + button booking for tax and compliance consultations.',
    role: 'CA/accountant firm',
    emoji: '📊',
    serviceHeader: '{{business_name}} 📊',
    serviceBody: 'Hi {{contact_name}}! Choose the consultation you need:',
    resourceHeader: 'Choose your consultant',
    resourceBody: 'Select a consultant for {{preferred_date}}:',
    slotsBody: 'Pick a slot with {{resource_name}} on {{preferred_date}}:',
    bookConfirm:
      '✅ Consultation confirmed!\n\nConsultant: {{resource_name}}\nWhen: {{booking_time}}\nService: {{service_type}}',
    leadNotes: 'CA consultation booking from WhatsApp',
  },
  travel: {
    slug: 'travel-booking',
    name: 'Travel Trip Booking Assistant',
    description: 'AI welcome + button booking for trip planning and travel consultations.',
    role: 'travel agency',
    emoji: '✈️',
    serviceHeader: '{{business_name}} ✈️',
    serviceBody: 'Hi {{contact_name}}! How can we help with your trip?',
    resourceHeader: 'Choose your travel expert',
    resourceBody: 'Select an expert for {{preferred_date}}:',
    slotsBody: 'Available call times with {{resource_name}} on {{preferred_date}}:',
    bookConfirm:
      '✅ Session confirmed!\n\nExpert: {{resource_name}}\nWhen: {{booking_time}}\nTopic: {{service_type}}',
    leadNotes: 'Travel consultation booking from WhatsApp',
  },
};

function buildLiveAppointmentFlow(vertical: SchedulingVertical): WorkflowTemplate {
  const meta = LIVE_APPOINTMENT_BY_VERTICAL[vertical];
  const resourceLabel = getVerticalAvailabilityDefaults(vertical).resourceLabel.toLowerCase();

  return {
    slug: meta.slug,
    name: meta.name,
    description: meta.description,
    category: 'guided',
    trigger_type: 'message_received',
    definition: linearFlow([
      triggerNode(),
      aiNode(
        'ai-welcome',
        160,
        'AI Welcome',
        'Personalized AI greeting',
        LIVE_APPOINTMENT_AI.welcome(meta.role),
      ),
      sendNode('send-welcome', 240, 'Send Welcome', '{{ai_response}}'),
      pickAppointmentServicesNode(
        'pick-service',
        320,
        'Pick Service',
        meta.serviceHeader,
        meta.serviceBody,
        'Tap a button to continue',
      ),
      aiNode(
        'ai-service-ack',
        400,
        'AI Service Ack',
        'Acknowledges service selection',
        LIVE_APPOINTMENT_AI.serviceAck,
      ),
      sendNode('send-service-ack', 480, 'Send Ack', '{{ai_response}}'),
      pickDateNode(
        'pick-date',
        560,
        'Pick Date',
        'When would you like to visit? Tap *Today* or *Tomorrow* below 👇',
        '📅 Choose your day',
      ),
      listResourcesNode(
        'list-resources',
        640,
        `Pick ${resourceLabel}`,
        meta.resourceBody,
        meta.resourceHeader,
      ),
      listSlotsNode('list-slots', 760, 'Pick Slot', meta.slotsBody),
      bookSlotNode('book-slot', 880, 'Confirm Booking', meta.bookConfirm),
      aiNode(
        'ai-thanks',
        1000,
        'AI Thank You',
        'Personalized confirmation',
        LIVE_APPOINTMENT_AI.thankYou,
      ),
      sendNode('send-thanks', 1080, 'Send Thanks', '{{ai_response}}'),
      ...leadSaveOnly(1200, {
        collectedFields: ['service_type', 'preferred_date', 'resource_name', 'booking_time'],
        notes: meta.leadNotes,
      }),
    ]),
  };
}

// --- Salon ---

const salonAppointment = buildLiveAppointmentFlow('salon');

// --- Real Estate ---

const realEstateLeadGen: WorkflowTemplate = {
  slug: 'real-estate-lead-gen',
  name: 'Real Estate Lead Qualification',
  description:
    'Multi-step lead qualification: asks budget, location, and property type one at a time, saves the lead, then confirms.',
  category: 'guided',
  trigger_type: 'message_received',
  definition: linearFlow([
    triggerNode(),
    collectNode(
      'collect-budget',
      200,
      'budget',
      'Ask Budget',
      'What is your budget range? (e.g. ₹50 lakh – ₹80 lakh)',
    ),
    collectNode(
      'collect-location',
      320,
      'location',
      'Ask Location',
      'Which area or location are you looking in?',
    ),
    collectNode(
      'collect-type',
      440,
      'property_type',
      'Ask Property Type',
      'Buy or rent? Which type — 1BHK, 2BHK, or house?',
    ),
    ...leadCaptureTail(
      560,
      "Hi {{contact_name}}! ✅ We've saved your enquiry.\n\nBudget: {{budget}}\nLocation: {{location}}\nType: {{property_type}}\n\nAn agent will contact you within 24 hours.",
      {
        collectedFields: ['budget', 'location', 'property_type'],
        notes: 'Real estate lead from WhatsApp',
      },
    ),
  ]),
};

const realEstateAppointment = buildLiveAppointmentFlow('real_estate');

const realEstateFaq: WorkflowTemplate = {
  slug: 'real-estate-faq',
  name: 'Real Estate FAQ Bot',
  description: 'Auto-reply when customers ask about rent, price, or location keywords.',
  category: 'guided',
  trigger_type: 'message_received',
  definition: linearFlow([
    triggerNode(),
    {
      id: 'condition-1',
      type: 'condition',
      y: 200,
      data: {
        label: 'Price / Rent Keyword',
        summary: 'Matches price, rent, cost',
        field: 'message',
        operator: 'contains',
        value: 'price',
      },
    },
    sendNode(
      'send-1',
      320,
      'Pricing Info',
      '💰 For latest prices and available units, share your budget and preferred location — our agent will send matching listings within a few hours.',
    ),
  ]),
};

// --- Clinic ---

const clinicAppointment = buildLiveAppointmentFlow('clinic');

const clinicSupport: WorkflowTemplate = {
  slug: 'clinic-support',
  name: 'Clinic Patient Support',
  description: 'Answer general patient queries about timings, location, and reports.',
  category: 'guided',
  trigger_type: 'message_received',
  definition: linearFlow([
    triggerNode(),
    aiNode(
      'ai-1',
      200,
      'Patient Support',
      'General clinic queries',
      'You are a helpful clinic WhatsApp assistant. Answer general questions about timings, location, reports, and follow-ups. Patient wrote: "{{message}}". Do NOT diagnose or prescribe. For emergencies, tell them to call emergency services or visit the clinic.',
    ),
    sendNode('send-1', 320, 'Send Reply', '{{ai_response}}'),
  ]),
};

// --- Coaching ---

const coachingLeadGen: WorkflowTemplate = {
  slug: 'coaching-lead-gen',
  name: 'Coaching Admission Lead Capture',
  description: 'Capture course enquiries and admission leads from prospective students.',
  category: 'guided',
  trigger_type: 'message_received',
  definition: linearFlow([
    triggerNode(),
    aiNode(
      'ai-1',
      200,
      'Admission Assistant',
      'Qualifies course interest',
      'You are an admissions assistant for a coaching institute. Student message: "{{message}}". Ask about: course/exam interest, current class/background, and preferred batch mode (online/offline). Be encouraging and concise.',
    ),
    sendNode('send-1', 320, 'Send Reply', '{{ai_response}}'),
    ...leadCaptureTail(
      440,
      "Thanks {{contact_name}}! 📚 We've received your enquiry. Our counsellor will call you with batch details and fees.",
      { notes: 'Coaching admission lead from WhatsApp' },
    ),
  ]),
};

const coachingInstagramLeadGen: WorkflowTemplate = {
  slug: 'coaching-lead-gen-instagram',
  name: 'Instagram Admission Lead Capture',
  description: 'Capture course enquiries from Instagram DMs and save them as leads.',
  category: 'guided',
  trigger_type: 'message_received',
  definition: linearFlow([
    triggerNode(80, 'instagram'),
    aiNode(
      'ai-1',
      200,
      'Admission Assistant',
      'Qualifies course interest',
      'You are an admissions assistant for a coaching institute. Student Instagram DM: "{{message}}". Ask about: course/exam interest, current class/background, and preferred batch mode (online/offline). Be encouraging and concise.',
    ),
    sendNode('send-1', 320, 'Send Reply', '{{ai_response}}'),
    ...leadCaptureTail(
      440,
      "Thanks {{contact_name}}! 📚 We've received your enquiry. Our counsellor will DM you with batch details and fees.",
      { notes: 'Coaching admission lead from Instagram', channel: 'instagram' },
    ),
  ]),
};

const coachingAppointment = buildLiveAppointmentFlow('coaching');

// --- Local Shop ---

const localShopFaq: WorkflowTemplate = {
  slug: 'local-shop-faq',
  name: 'Local Shop FAQ Bot',
  description: 'Answer common shop questions about hours, prices, and location.',
  category: 'guided',
  trigger_type: 'message_received',
  definition: linearFlow([
    triggerNode(),
    {
      id: 'condition-1',
      type: 'condition',
      y: 200,
      data: {
        label: 'Hours Keyword',
        summary: 'Matches hours, timing, open',
        field: 'message',
        operator: 'contains',
        value: 'hours',
      },
    },
    sendNode(
      'send-1',
      320,
      'Store Hours',
      '🕐 Shop hours:\nMon–Sat: 10:00 AM – 8:00 PM\nSun: 10:00 AM – 2:00 PM\n\nReply *price* or *location* for more info!',
    ),
  ]),
};

const localShopSupport: WorkflowTemplate = {
  slug: 'local-shop-support',
  name: 'Local Shop Order Support',
  description: 'Help customers with orders, availability, and delivery status.',
  category: 'guided',
  trigger_type: 'message_received',
  definition: linearFlow([
    triggerNode(),
    {
      id: 'condition-1',
      type: 'condition',
      y: 200,
      data: {
        label: 'Order Keyword',
        summary: 'Matches order, delivery',
        field: 'message',
        operator: 'contains',
        value: 'order',
      },
    },
    sendNode(
      'send-1',
      320,
      'Order Help',
      "Hi {{contact_name}}! 📦 For order updates, share your order ID or the product name. We'll check availability and delivery status right away.",
    ),
  ]),
};

// --- Travel ---

const travelBooking = buildLiveAppointmentFlow('travel');

const travelLeadGen: WorkflowTemplate = {
  slug: 'travel-lead-gen',
  name: 'Travel Package Lead Capture',
  description: 'Capture holiday package enquiries and save leads.',
  category: 'guided',
  trigger_type: 'message_received',
  definition: linearFlow([
    triggerNode(),
    aiNode(
      'ai-1',
      200,
      'Package Enquiry',
      'Qualifies travel interest',
      'You work for a travel agency. Message: "{{message}}". Ask destination, dates, group size, and budget to prepare a package quote.',
    ),
    sendNode('send-1', 320, 'Send Reply', '{{ai_response}}'),
    ...leadCaptureTail(
      440,
      "Thanks {{contact_name}}! 🌴 We've saved your trip enquiry. Our travel expert will share package options soon.",
      { notes: 'Travel package lead from WhatsApp' },
    ),
  ]),
};

// --- Insurance ---

const insuranceLeadGen: WorkflowTemplate = {
  slug: 'insurance-lead-gen',
  name: 'Insurance Policy Lead Qualification',
  description: 'Qualify insurance leads and capture policy interest.',
  category: 'guided',
  trigger_type: 'message_received',
  definition: linearFlow([
    triggerNode(),
    aiNode(
      'ai-1',
      200,
      'Policy Advisor',
      'Asks policy type and coverage needs',
      'You are an insurance agent on WhatsApp. Client wrote: "{{message}}". Ask what type of insurance they need (life/health/motor), age/coverage amount if relevant, and when they want to start. No legal guarantees.',
    ),
    sendNode('send-1', 320, 'Send Reply', '{{ai_response}}'),
    ...leadCaptureTail(
      440,
      "Hi {{contact_name}}! We've registered your insurance enquiry. An advisor will share plan options shortly.",
      { notes: 'Insurance lead from WhatsApp' },
    ),
  ]),
};

const insuranceSales: WorkflowTemplate = {
  slug: 'insurance-sales',
  name: 'Insurance Sales Assistant',
  description: 'AI assistant to explain plans and nudge policy renewals or upgrades.',
  category: 'guided',
  trigger_type: 'message_received',
  definition: linearFlow([
    triggerNode(),
    aiNode(
      'ai-1',
      200,
      'Sales Assistant',
      'Explains plans and benefits',
      'You are an insurance sales assistant. Message: "{{message}}". Explain relevant plan benefits simply, answer objections, and suggest booking a call with an advisor. Never guarantee returns.',
    ),
    sendNode('send-1', 320, 'Send Reply', '{{ai_response}}'),
  ]),
};

// --- Farmer ---

const farmerSupport: WorkflowTemplate = {
  slug: 'farmer-support',
  name: 'Agriculture Support Assistant',
  description: 'Help farmers with crop queries, supplies, and seasonal advice.',
  category: 'guided',
  trigger_type: 'message_received',
  definition: linearFlow([
    triggerNode(),
    aiNode(
      'ai-1',
      200,
      'Agri Support',
      'Crop and supply help',
      'You assist farmers via WhatsApp for an agriculture business. Message: "{{message}}". Help with crops, seeds, fertilizers, weather-related tips, and ordering supplies. Be practical and concise.',
    ),
    sendNode('send-1', 320, 'Send Reply', '{{ai_response}}'),
  ]),
};

const farmerFaq: WorkflowTemplate = {
  slug: 'farmer-faq',
  name: 'Agriculture FAQ Bot',
  description: 'Quick answers when farmers ask about prices or availability.',
  category: 'guided',
  trigger_type: 'message_received',
  definition: linearFlow([
    triggerNode(),
    {
      id: 'condition-1',
      type: 'condition',
      y: 200,
      data: {
        label: 'Price Keyword',
        summary: 'Matches price, rate, cost',
        field: 'message',
        operator: 'contains',
        value: 'price',
      },
    },
    sendNode(
      'send-1',
      320,
      'Price Info',
      '🌾 For current rates on seeds, fertilizer, or produce, share the product name and quantity. Our team will reply with today\'s prices.',
    ),
  ]),
};

// --- CA / Accountant ---

const caAccountantAppointment = buildLiveAppointmentFlow('ca_accountant');

const caAccountantSupport: WorkflowTemplate = {
  slug: 'ca-accountant-support',
  name: 'CA & Tax Support Assistant',
  description: 'Answer client questions about filings, GST, and document requirements.',
  category: 'guided',
  trigger_type: 'message_received',
  definition: linearFlow([
    triggerNode(),
    aiNode(
      'ai-1',
      200,
      'Tax Support',
      'Filing and document help',
      'You are a CA firm WhatsApp assistant. Client: "{{message}}". Help with GST, ITR, document checklists, and deadlines. Do not give specific tax advice without disclaimers; suggest a consultation for complex cases.',
    ),
    sendNode('send-1', 320, 'Send Reply', '{{ai_response}}'),
  ]),
};

// --- Customer support team (business type) ---

const supportTeamAssistant: WorkflowTemplate = {
  slug: 'support-team-assistant',
  name: 'Support Team AI Assistant',
  description: 'Triage and reply to customer tickets over WhatsApp.',
  category: 'guided',
  trigger_type: 'message_received',
  definition: linearFlow([
    triggerNode(),
    aiNode(
      'ai-1',
      200,
      'Support Triage',
      'Acknowledges and categorizes issue',
      'You are a customer support agent. Message: "{{message}}". Acknowledge the issue, ask one clarifying question if needed, and give an estimated response time. Stay professional and empathetic.',
    ),
    sendNode('send-1', 320, 'Send Reply', '{{ai_response}}'),
  ]),
};

export const GUIDED_WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  salonAppointment,
  realEstateLeadGen,
  realEstateAppointment,
  realEstateFaq,
  clinicAppointment,
  clinicSupport,
  coachingLeadGen,
  coachingInstagramLeadGen,
  coachingAppointment,
  localShopFaq,
  localShopSupport,
  travelBooking,
  travelLeadGen,
  insuranceLeadGen,
  insuranceSales,
  farmerSupport,
  farmerFaq,
  caAccountantAppointment,
  caAccountantSupport,
  supportTeamAssistant,
];

export function findGuidedTemplate(slug: string): WorkflowTemplate | undefined {
  return GUIDED_WORKFLOW_TEMPLATES.find((t) => t.slug === slug);
}

/** Resolves a template from starter or guided catalogues. */
export function findAnyTemplate(slug: string): WorkflowTemplate | undefined {
  return findTemplate(slug) ?? findGuidedTemplate(slug);
}
