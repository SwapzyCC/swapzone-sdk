/**
 * Walks `offset` forward one page at a time, yielding every item, and stops
 * at the first page shorter than `pageSize`.
 */
export async function* paginate<T>(
  fetchPage: (limit: number, offset: number) => Promise<T[]>,
  pageSize: number,
): AsyncGenerator<T, void, undefined> {
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new RangeError(`pageSize must be a positive integer, got ${pageSize}`);
  }

  for (let offset = 0; ; offset += pageSize) {
    const page = await fetchPage(pageSize, offset);
    yield* page;
    if (page.length < pageSize) return;
  }
}
