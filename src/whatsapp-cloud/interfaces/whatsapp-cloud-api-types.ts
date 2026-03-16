export interface WhatsappCloudTextMessagePayload {
  messaging_product: 'whatsapp';
  to: string;
  type: 'text';
  text: {
    body: string;
  };
}

export interface WhatsappCloudApiError {
  error?: {
    message?: string;
    code?: number;
  };
}
