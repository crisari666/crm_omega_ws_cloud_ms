/**
 * Data needed to purge a removed recruiting candidate's WhatsApp history.
 */
export interface RecruitingPurgeInput {
  readonly phone: string;
  /** Messages at or after this instant are deleted. */
  readonly since: Date;
  /** CV / video message ids, deleted even when older than `since`. */
  readonly mediaMessageIds: readonly string[];
}
