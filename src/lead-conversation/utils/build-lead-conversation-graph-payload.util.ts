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
import type { LeadConversationSendCommand } from '../types/lead-conversation-send-command.interface';

type GraphPayload = Record<string, unknown>;

const truncate = (value: string, max: number): string =>
  value.length <= max ? value : `${value.slice(0, max - 1)}…`;

function buildBaseEnvelope(to: string): GraphPayload {
  return { messaging_product: 'whatsapp', recipient_type: 'individual', to };
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
    default:
      throw new Error(`unsupported lead conversation message kind`);
  }
}
