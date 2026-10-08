/**
 * Meet template delivery status reported to the CRM (`spam` = blocked by Meta ecosystem
 * rules or the user opted out of marketing).
 */
export type RecruitingMeetStatus = 'sent' | 'delivered' | 'read' | 'failed' | 'spam';
