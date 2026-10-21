/**
 * Chess.com usernames are 3–25 characters of letters, digits, underscore and hyphen, and
 * are case-insensitive. The normalised (lower-case) form is the only form we store or
 * compare. It mirrors `public.normalize_chess_username` / `is_valid_chess_username` in SQL.
 */
const VALID = /^[a-z0-9_-]{3,25}$/;

export function normalizeChessUsername(input: string): string {
  return input.trim().toLowerCase();
}

export function isValidChessUsername(input: string): boolean {
  return VALID.test(input);
}

/**
 * Accepts a bare username or a pasted profile link (https://www.chess.com/member/Name)
 * and returns the normalised username, or null when it is not a valid Chess.com username.
 */
export function parseChessUsername(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const link = raw.match(
    /^(?:https?:\/\/)?(?:www\.)?chess\.com\/(?:member|players?)\/([^/?#\s]+)\/?(?:[?#].*)?$/i,
  );
  const candidate = normalizeChessUsername(link ? decodeURIComponent(link[1]!) : raw);
  return isValidChessUsername(candidate) ? candidate : null;
}

export function chessProfileUrl(username: string): string {
  return `https://www.chess.com/member/${encodeURIComponent(username)}`;
}
