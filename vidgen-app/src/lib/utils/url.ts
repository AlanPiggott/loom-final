/**
 * Normalize URL to prevent junk URLs from entering the database
 * @param url Raw URL string (may or may not have protocol)
 * @returns Normalized URL string or null if invalid
 */
export function normalizeUrl(url: string): string | null {
  try {
    const normalized = new URL(url.startsWith('http') ? url : `https://${url}`);
    return normalized.toString();
  } catch {
    return null;
  }
}
