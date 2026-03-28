import { COMPANY_PUBLIC_CONTACT_INFO } from '../../constants/app-constants';

type CompanyPublicContactFields = {
  [K in keyof typeof COMPANY_PUBLIC_CONTACT_INFO]: string;
};

/**
 * Builds the tool output string the model should paraphrase for the user (plain text, WhatsApp-friendly).
 */
export function buildCompanyInformationToolResponse(info: CompanyPublicContactFields): string {
  const lines: string[] = [];
  const pushIfNonEmpty = (label: string, value: string): void => {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      lines.push(`${label}: ${trimmed}`);
    }
  };
  pushIfNonEmpty('Sitio web', info.primaryWebsiteUrl);
  pushIfNonEmpty('Sitio web adicional', info.secondaryWebsiteUrl);
  pushIfNonEmpty('Teléfono de contacto', info.contactPhone);
  pushIfNonEmpty('Dirección', info.address);
  // pushIfNonEmpty('Facebook', info.facebookUrl);
  // pushIfNonEmpty('Instagram', info.instagramUrl);
  // pushIfNonEmpty('LinkedIn', info.linkedinUrl);
  // pushIfNonEmpty('TikTok', info.tiktokUrl);
  if (lines.length === 0) {
    return 'No hay datos de empresa configurados en la aplicación. Pide disculpas y ofrece seguir por este chat o con un asesor.';
  }
  return `Usa un tono cercano y comparte estos datos al usuario (puedes ordenarlos en frases cortas, sin Markdown):\n${lines.join('\n')}`;
}
