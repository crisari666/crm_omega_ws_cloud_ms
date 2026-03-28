import { COMPANY_PUBLIC_CONTACT_INFO } from '../../constants/app-constants';
import { buildCompanyInformationToolResponse } from './build-company-information-tool-response.util';

describe('buildCompanyInformationToolResponse', () => {
  it('returns fallback when all fields are empty', () => {
    const actual = buildCompanyInformationToolResponse(COMPANY_PUBLIC_CONTACT_INFO);
    expect(actual).toContain('No hay datos de empresa configurados');
  });

  it('includes non-empty fields in the output', () => {
    const inputInfo = {
      ...COMPANY_PUBLIC_CONTACT_INFO,
      primaryWebsiteUrl: 'https://example.com',
      contactPhone: '+57 300 0000000',
    };
    const actual = buildCompanyInformationToolResponse(inputInfo);
    expect(actual).toContain('https://example.com');
    expect(actual).toContain('+57 300 0000000');
  });
});
