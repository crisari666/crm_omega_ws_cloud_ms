import { normalizeWaId } from '../../whatsapp-cloud/utils/normalize-wa-id.util';
import {
  DEFAULT_LIST_BUTTON_LABEL,
  DEFAULT_LIST_SECTION_TITLE,
  MAX_LIST_BUTTON_LABEL_LENGTH,
  MAX_LIST_ROW_DESCRIPTION_LENGTH,
  MAX_LIST_ROW_TITLE_LENGTH,
  MAX_LIST_ROWS,
  MAX_REPLY_BUTTON_TITLE_LENGTH,
  MAX_REPLY_BUTTONS,
} from '../constants/lead-conversation.constants';
import type { LeadConversationButton } from '../types/lead-conversation-button.interface';
import type { LeadConversationContact } from '../types/lead-conversation-contact.interface';
import type { LeadConversationSendCommand } from '../types/lead-conversation-send-command.interface';

type GraphPayload = Record<string, unknown>;

const VENTOR_CONTACT_COMPANY = 'La Ceiba Group' as const;
const VENTOR_CONTACT_TITLE = 'Asesor Comercial Asignado' as const;

const truncate = (value: string, max: number): string =>
  value.length <= max ? value : `${value.slice(0, max - 1)}…`;

function buildBaseEnvelope(to: string): GraphPayload {
  return { messaging_product: 'whatsapp', recipient_type: 'individual', to };
}

function buildContactsPayload(to: string, contact: LeadConversationContact): GraphPayload {
  const firstName: string = contact.firstName.trim();
  const lastName: string = contact.lastName.trim();
  const phones = contact.phones
    .map((entry) => {
      const phone: string = entry.phone.trim();
      if (phone.length === 0) return null;
      const waIdSource: string =
        entry.waId != null && entry.waId.trim().length > 0 ? entry.waId.trim() : phone;
      const waId: string = normalizeWaId(waIdSource);
      if (waId.length === 0) return null;
      return { phone, type: entry.type, wa_id: waId };
    })
    .filter(
      (entry): entry is { phone: string; type: 'CELL' | 'WORK' | 'MAIN'; wa_id: string } =>
        entry != null,
    );
  if (phones.length === 0) {
    throw new Error('contacts message requires at least one phone');
  }
  const displayName: string = `${firstName} ${lastName}`.trim();
  const formattedName: string =
    displayName.length > 0 ? `${displayName} (Asesor La Ceiba)` : 'Asesor La Ceiba';
  return {
    ...buildBaseEnvelope(to),
    type: 'contacts',
    contacts: [
      {
        name: {
          formatted_name: formattedName,
          first_name: firstName.length > 0 ? firstName : 'Asesor',
          last_name: lastName,
        },
        phones,
        org: {
          company: VENTOR_CONTACT_COMPANY,
          title: VENTOR_CONTACT_TITLE,
        },
      },
    ],
  };
}

function buildButtonsInteractive(body: string, buttons: readonly LeadConversationButton[]): GraphPayload {
  return {
    type: 'button',
    body: { text: body },
    action: {
      buttons: buttons.slice(0, MAX_REPLY_BUTTONS).map((button) => ({
        type: 'reply',
        reply: { id: button.id, title: truncate(button.title, MAX_REPLY_BUTTON_TITLE_LENGTH) },
      })),
    },
  };
}

function buildListInteractive(
  body: string,
  rows: readonly LeadConversationButton[],
  listButtonLabel: string,
): GraphPayload {
  return {
    type: 'list',
    body: { text: body },
    action: {
      button: truncate(listButtonLabel, MAX_LIST_BUTTON_LABEL_LENGTH),
      sections: [
        {
          title: DEFAULT_LIST_SECTION_TITLE,
          rows: rows.slice(0, MAX_LIST_ROWS).map((row) => ({
            id: row.id,
            title: truncate(row.title, MAX_LIST_ROW_TITLE_LENGTH),
            ...(row.description
              ? { description: truncate(row.description, MAX_LIST_ROW_DESCRIPTION_LENGTH) }
              : {}),
          })),
        },
      ],
    },
  };
}

/**
 * Builds a Meta Graph `/messages` payload for a lead-conversation send command.
 * @throws Error when required fields for the given kind are missing.
 */
export function buildLeadConversationGraphPayload(command: LeadConversationSendCommand): GraphPayload {
  const base = buildBaseEnvelope(command.to.trim());
  const body = (command.body ?? '').trim();
  const options = command.buttons ?? [];
  switch (command.kind) {
    case 'text':
      if (!body) throw new Error('text message requires body');
      return { ...base, type: 'text', text: { body, preview_url: false } };
    case 'image':
      if (!command.mediaUrl) throw new Error('image message requires mediaUrl');
      return { ...base, type: 'image', image: { link: command.mediaUrl, ...(body ? { caption: body } : {}) } };
    case 'document':
      if (!command.mediaUrl) throw new Error('document message requires mediaUrl');
      return {
        ...base,
        type: 'document',
        document: {
          link: command.mediaUrl,
          ...(body ? { caption: body } : {}),
          ...(command.fileName ? { filename: command.fileName } : {}),
        },
      };
    case 'buttons':
      if (!body || options.length === 0) throw new Error('buttons message requires body and buttons');
      return { ...base, type: 'interactive', interactive: buildButtonsInteractive(body, options) };
    case 'list':
      if (!body || options.length === 0) throw new Error('list message requires body and rows');
      return {
        ...base,
        type: 'interactive',
        interactive: buildListInteractive(body, options, command.listButtonLabel ?? DEFAULT_LIST_BUTTON_LABEL),
      };
    case 'contacts':
      if (command.contact == null) throw new Error('contacts message requires contact');
      return buildContactsPayload(command.to.trim(), command.contact);
    default:
      throw new Error(`unsupported lead conversation message kind`);
  }
}
