import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { TimeClassBadge } from "@/components/chess/badges";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils";
import type { MatchRow } from "@/server/data/public";

const resultText = { white: "1–0", black: "0–1", draw: "½–½" } as const;

export function MatchesTable({ rows, perspective }: { rows: MatchRow[]; perspective?: string }) {
  return (
    <Table>
      <caption className="sr-only">Verified college matches</caption>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>White</TableHead>
          <TableHead className="text-center">Result</TableHead>
          <TableHead>Black</TableHead>
          <TableHead>Control</TableHead>
          <TableHead>Finished</TableHead>
          <TableHead className="text-right">Game</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((m) => {
          const win = perspective
            ? perspective === m.white_username
              ? m.result === "white"
              : perspective === m.black_username
                ? m.result === "black"
                : null
            : null;
          return (
            <TableRow key={m.id}>
              <TableCell>
                <PlayerLink
                  username={m.white_username}
                  name={m.white_display_name}
                  strong={m.result === "white"}
                />
              </TableCell>
              <TableCell className="text-center">
                <span className="tabular font-mono text-sm font-semibold">
                  {resultText[m.result as keyof typeof resultText]}
                </span>
                {win !== null ? (
                  <Badge
                    className="ml-2"
                    variant={m.result === "draw" ? "neutral" : win ? "success" : "danger"}
                  >
                    {m.result === "draw" ? "Draw" : win ? "Win" : "Loss"}
                  </Badge>
                ) : null}
                {m.source === "admin" ? (
                  <Badge className="ml-2" variant="info" title="Result confirmed by a moderator">
                    Moderated
                  </Badge>
                ) : null}
              </TableCell>
              <TableCell>
                <PlayerLink
                  username={m.black_username}
                  name={m.black_display_name}
                  strong={m.result === "black"}
                />
              </TableCell>
              <TableCell>
                <span className="flex items-center gap-2">
                  <TimeClassBadge timeClass={m.time_class} />
                  <span className="tabular text-xs text-muted-foreground">
                    {m.time_control ?? "—"}
                  </span>
                </span>
              </TableCell>
              <TableCell className="text-sm whitespace-nowrap text-muted-foreground">
                {formatDateTime(m.ended_at)}
              </TableCell>
              <TableCell className="text-right">
                <a
                  href={m.game_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  View <ExternalLink className="size-3" aria-hidden />
                  <span className="sr-only">game on Chess.com</span>
                </a>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function PlayerLink({
  username,
  name,
  strong,
}: {
  username: string;
  name: string | null;
  strong: boolean;
}) {
  return (
    <Link
      href={`/players/${username}`}
      className={`grid leading-tight hover:underline ${strong ? "font-semibold" : ""}`}
    >
      <span>{name ?? username}</span>
      {name ? <span className="text-xs font-normal text-muted-foreground">@{username}</span> : null}
    </Link>
  );
}
