import { Contact } from '@prisma/client';

/** Human-readable label for inbox activity and notifications. */
export function contactDisplayLabel(
  contact: Pick<Contact, 'phone' | 'username' | 'name' | 'channel'>,
): string {
  if (contact.username) {
    return contact.username.startsWith('@') ? contact.username : `@${contact.username}`;
  }
  if (contact.phone) {
    return contact.phone;
  }
  if (contact.name) {
    return contact.name;
  }
  return contact.channel === 'instagram' ? 'Instagram user' : 'Contact';
}
