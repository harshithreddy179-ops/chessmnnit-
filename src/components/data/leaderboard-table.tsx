import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { PlayerAvatar } from "@/components/ui/avatar";
import { RankMark } from "@/components/chess/badges";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { chessProfileUrl } from "@/lib/chess/username";
import { formatPercent, formatRelative } from "@/lib/utils";
import type { BoardId, LeaderboardRow } from "@/server/data/public";

const COLUMNS: Record<BoardId, { head: string; cell: (r: LeaderboardRow) => React.ReactNode }[]> = {
  chesscom_rating: [
    { head: "Rating", cell: (r) => <span className="font-semibold">{r.chess_rating}</span> },
    {
      head: "Refreshed",
      cell: (r) => (
        <span className="text-muted-foreground">{formatRelative(r.ratings_synced_at)}</span>
      ),
    },
  ],
  points: [
    { head: "Points", cell: (r) => <span className="font-semibold">{r.points}</span> },
    { head: "W-D-L", cell: (r) => `${r.wins}-${r.draws}-${r.losses}` },
  ],
  wins: [
    { head: "Wins", cell: (r) => <span className="font-semibold">{r.wins}</span> },
    { head: "Losses", cell: (r) => r.losses },
    { head: "Games", cell: (r) => r.games_played },
  ],
  elo: [
    {
      head: "Elo",
      cell: (r) => <span className="font-semibold">{Math.round(Number(r.elo))}</span>,
    },
    { head: "Games", cell: (r) => r.games_played },
  ],
  games: [
    { head: "Games", cell: (r) => <span className="font-semibold">{r.games_played}</span> },
    { head: "Wins", cell: (r) => r.wins },
  ],
  win_rate: [
    {
      head: "Win rate",
      cell: (r) => <span className="font-semibold">{formatPercent(Number(r.win_rate), 0)}</span>,
    },
    {
      head: "Sample",
      cell: (r) => (
        <span title="Completed college games this rate is based on">
          {r.wins} / {r.games_played}
        </span>
      ),
    },
  ],
  activity: [
    { head: "Last 30 days", cell: (r) => <span className="font-semibold">{r.matches_30d}</span> },
    {
      head: "Last match",
      cell: (r) => <span className="text-muted-foreground">{formatRelative(r.last_match_at)}</span>,
    },
  ],
};

export function LeaderboardTable({
  board,
  rows,
  caption,
  compact = false,
}: {
  board: BoardId;
  rows: LeaderboardRow[];
  caption: string;
  compact?: boolean;
}) {
  const cols = COLUMNS[board];
  return (
    <Table>
      <caption className="sr-only">{caption}</caption>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-12">#</TableHead>
          <TableHead>Player</TableHead>
          {cols.map((c) => (
            <TableHead key={c.head} className="text-right">
              {c.head}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.user_id}>
            <TableCell>
              <RankMark rank={Number(r.rank)} />
            </TableCell>
            <TableCell>
              <Link href={`/players/${r.chess_username}`} className="group flex items-center gap-3">
                <PlayerAvatar
                  name={r.display_name}
                  src={r.avatar_url}
                  className={compact ? "size-7" : "size-8"}
                />
                <span className="grid leading-tight">
                  <span className="font-medium group-hover:underline">{r.display_name}</span>
                  <span className="text-xs text-muted-foreground">@{r.chess_username}</span>
                </span>
              </Link>
            </TableCell>
            {cols.map((c) => (
              <TableCell key={c.head} className="tabular text-right font-mono text-sm">
                {c.cell(r)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function ExternalChessLink({
  username,
  children,
}: {
  username: string;
  children?: React.ReactNode;
}) {
  return (
    <a
      href={chessProfileUrl(username)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-primary hover:underline"
    >
      {children ?? `@${username}`} <ExternalLink className="size-3" aria-hidden />
      <span className="sr-only">(opens Chess.com)</span>
    </a>
  );
}
