# WhatsApp Cloud MS — Chat history HTTP API

All routes are served under the **global prefix** `ws-cloud` (see `main.ts`). Example base URL: `https://<host>:<APP_PORT>/ws-cloud`.

## Environment variables

| Variable | Purpose |
|----------|---------|
| `DATABASE_USER`, `DATABASE_PASS`, `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME` | MongoDB connection for chat and message collections |
| `WHATSAPP_CLOUD_ACCESS_TOKEN` | Meta Graph token (used by Kapso `WhatsAppClient`) |
| `WHATSAPP_CLOUD_PHONE_NUMBER_ID` | Sending phone number id |
| `WHATSAPP_CLOUD_API_VERSION` | Graph version (default `v23.0`) |
| `WHATSAPP_MEDIA_UPLOAD_DIR` | Directory for inbound media files (default `./uploads/whatsapp-media` relative to process cwd) |
| `WHATSAPP_KAPSO_BASE_URL` | Optional Kapso proxy base URL |
| `WHATSAPP_KAPSO_API_KEY` | Optional Kapso API key when using proxy |

## Chats

### List chats

`GET /ws-cloud/whatsapp-cloud/chats`

**Query**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `limit` | integer | 20 | Page size (1–100) |
| `before` | Mongo ObjectId | — | Cursor: return chats older than this `_id` (newest-first) |

**Response**

```json
{
  "items": [
    {
      "id": "674a...",
      "waId": "573001234567",
      "phoneNumberId": "123456789",
      "displayPhoneNumber": "+1 555 000 1111",
      "profileName": "Jane",
      "lastMessageAt": "2026-03-27T12:00:00.000Z",
      "createdAt": "2026-03-27T10:00:00.000Z",
      "updatedAt": "2026-03-27T12:00:00.000Z"
    }
  ],
  "nextCursor": "674a...",
  "hasMore": true
}
```

### List messages in a chat

`GET /ws-cloud/whatsapp-cloud/chats/:chatId/messages`

**Query**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `limit` | integer | 30 | Page size (1–100) |
| `before` | Mongo ObjectId | — | Cursor: messages older than this `_id` (newest-first) |

**Response**

```json
{
  "items": [
    {
      "id": "674b...",
      "chatId": "674a...",
      "direction": "inbound",
      "whatsappMessageId": "wamid.HBgL...",
      "type": "text",
      "timestamp": "2026-03-27T12:00:00.000Z",
      "textBody": "Hello",
      "caption": null,
      "media": null,
      "contextMessageId": null,
      "interactiveSnapshot": null,
      "createdAt": "2026-03-27T12:00:00.001Z",
      "updatedAt": "2026-03-27T12:00:00.001Z"
    }
  ],
  "nextCursor": null,
  "hasMore": false
}
```

`media`, when present, includes `storedRelativePath` for files saved from inbound image/video/audio/document/sticker messages. Download via the attachment route below.

### Download inbound attachment

`GET /ws-cloud/whatsapp-cloud/chats/:chatId/messages/:messageId/attachment`

Streams the file with `Content-Type` from stored metadata. Returns **404** if the message has no stored file or the file was removed from disk.

## Send messages (by chat)

`:chatId` is the MongoDB `_id` of the chat document (from the list-chats response). The service resolves the WhatsApp user id (`waId`) and sends through the Kapso client to Meta.

### Text

`POST /ws-cloud/whatsapp-cloud/chats/:chatId/messages/text`

**Body**

```json
{ "body": "Message text" }
```

### Image

`POST /ws-cloud/whatsapp-cloud/chats/:chatId/messages/image`

**Body** (provide **either** `id` or `link`)

```json
{
  "id": "<uploaded_media_id>",
  "caption": "optional"
}
```

or

```json
{
  "link": "https://example.com/image.jpg",
  "caption": "optional"
}
```

### Document

`POST /ws-cloud/whatsapp-cloud/chats/:chatId/messages/document`

Same `id` / `link` pattern as image; optional `filename`, `caption`.

### Video

`POST /ws-cloud/whatsapp-cloud/chats/:chatId/messages/video`

Same `id` / `link` pattern; optional `caption`.

### Audio

`POST /ws-cloud/whatsapp-cloud/chats/:chatId/messages/audio`

Same `id` / `link` pattern; optional `voice` (boolean).

### Sticker

`POST /ws-cloud/whatsapp-cloud/chats/:chatId/messages/sticker`

Same `id` / `link` pattern (stickers usually use uploaded `id`).

## Other send endpoints (unchanged)

Existing routes under `whatsapp-cloud` (e.g. `POST /ws-cloud/whatsapp-cloud/messages/text`, templates, onboarding) remain available. Outbound sends performed through `WhatsappCloudService` are also written to MongoDB when Graph accepts the message.

## Webhook ingestion

`POST /ws-cloud/whatsapp-cloud/webhook` continues to emit RabbitMQ events to CRM. In addition, each inbound message is normalized with **Kapso** `normalizeWebhook`, stored in MongoDB, and inbound media is downloaded to `WHATSAPP_MEDIA_UPLOAD_DIR` when applicable.

## Smoke test

`GET /ws-cloud/whatsapp-cloud/chats/admin/test` → `{ "ok": true }`

## References

- [Meta — Sending messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages)
- Kapso SDK: [`@kapso/whatsapp-cloud-api`](https://www.npmjs.com/package/@kapso/whatsapp-cloud-api)
