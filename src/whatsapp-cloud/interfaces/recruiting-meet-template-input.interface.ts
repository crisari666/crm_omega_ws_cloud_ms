/**
 * Group Meet invitation template for a recruiting candidate.
 * Body named params: `contact_name`, `date_`, `time`; URL button suffix: Meet code.
 */
export interface RecruitingMeetTemplateInput {
  readonly phoneNumber: string;
  readonly templateName: string;
  readonly languageCode: string;
  readonly contactName: string;
  readonly dateText: string;
  readonly timeText: string;
  readonly meetCode: string;
}
