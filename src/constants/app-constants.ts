/**
 * Public-facing company data for the La Ceiba WhatsApp agent (`companyInformation` tool).
 * Replace empty strings with real URLs, phone, and address in each environment.
 */
export const COMPANY_PUBLIC_CONTACT_INFO = {
  primaryWebsiteUrl: 'https://laceiba.group/',
  secondaryWebsiteUrl: '',
  contactPhone: '321 314 4672',
  address: 'Carrera 9 # 127C-60, Oficina 213, Bogota, D.C, Colombia',
  facebookUrl: '',
  instagramUrl: '',
  linkedinUrl: '',
  tiktokUrl: '',
} as const;

/**
 * Spanish notice after ventor assignment; placeholders `[user_name]` and `[user_phone]`.
 * Keep in sync with crm-omega-customers-ms `ventor-assignment-message.constant.ts`.
 */
export const VENTOR_ASSIGNMENT_CUSTOMER_MESSAGE_TEMPLATE =
  'En este momento estamos asignando tu solicitud a nuestro asesor [user_name].\n\n📲 Contacto directo: [user_phone]\n\nEn breve recibirás atención personalizada.' as const;
