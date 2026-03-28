/**
 * Cursor-paginated list wrapper for chat APIs.
 */
export interface PaginatedResult<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}
