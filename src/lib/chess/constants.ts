export const TIME_CLASSES = ["bullet", "blitz", "rapid", "daily"] as const;
export type TimeClass = (typeof TIME_CLASSES)[number];

export const TIME_CLASS_LABEL: Record<TimeClass, string> = {
  bullet: "Bullet",
  blitz: "Blitz",
  rapid: "Rapid",
  daily: "Daily",
};

export function isTimeClass(value: unknown): value is TimeClass {
  return typeof value === "string" && (TIME_CLASSES as readonly string[]).includes(value);
}

/**
 * Stats keys returned by https://api.chess.com/pub/player/{username}/stats for the
 * standard-chess categories this app ranks. Variants (chess960, bughouse…) are ignored.
 */
export const STATS_KEY_TO_CLASS: Record<string, TimeClass> = {
  chess_bullet: "bullet",
  chess_blitz: "blitz",
  chess_rapid: "rapid",
  chess_daily: "daily",
};

export const CHESSCOM_GAME_URL = /^https:\/\/www\.chess\.com\/(?:game|analysis)\/(?:live|daily)\/\d+/;

/** Human wording for the verification statuses shown across the UI. */
export const STATUS_LABEL = {
  google: "Google account",
  eligibility: "College eligibility",
  chess: "Chess.com ownership",
  profile: "Profile",
} as const;

export const SUPPORT_NOTE =
  "Ratings shown here are imported from Chess.com and are not earned exclusively against MNNIT students.";
