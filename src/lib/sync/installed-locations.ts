// Pages through every client account where the app is installed.
// Pure paging logic (the fetch is injected) so it can be unit tested.

export type LocationPage<T> = { locations: T[]; count: number };

export async function listAllInstalledLocations<T>(
  fetchPage: (page: { skip: number; limit: number }) => Promise<LocationPage<T>>,
  pageSize = 100,
  maxPages = 200,
): Promise<T[]> {
  const all: T[] = [];
  for (let i = 0; i < maxPages; i++) {
    const page = await fetchPage({ skip: i * pageSize, limit: pageSize });
    all.push(...page.locations);
    // Stop on a short page, or once we have everything the API says exists.
    if (page.locations.length < pageSize || all.length >= page.count) break;
  }
  return all;
}
