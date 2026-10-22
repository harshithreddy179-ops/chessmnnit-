"use client";

import Link from "next/link";
import { useState } from "react";
import { PlayerAvatar } from "@/components/ui/avatar";
import { RatingBadge } from "@/components/chess/badges";
import {
  ChallengeButton,
  type ChallengeAbility,
  type TimeControlOption,
} from "@/components/forms/challenge-dialog";
import { PresenceDot, usePresence } from "@/components/realtime/presence";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { TIME_CLASS_LABEL, type TimeClass } from "@/lib/chess/constants";
import { formatPercent } from "@/lib/utils";
import type { DirectoryRow } from "@/server/data/public";

export function DirectoryTable({
  rows,
  timeClass,
  viewerId,
  viewerApproved,
  options,
}: {
  rows: DirectoryRow[];
  timeClass: TimeClass;
  viewerId: string | null;
  viewerApproved: boolean;
  options: TimeControlOption[];
}) {
  const presence = usePresence();
  const [onlineOnly, setOnlineOnly] = useState(false);
  const visible =
    onlineOnly && presence
      ? rows.filter((r) => ["available", "busy"].includes(presence.statusOf(r.user_id)))
      : rows;

  return (
    <div className="grid gap-3">
      {presence ? (
        <div className="flex items-center gap-2">
          <Switch id="online-only" checked={onlineOnly} onCheckedChange={setOnlineOnly} />
          <Label htmlFor="online-only" className="text-sm">
            Show only players online now{" "}
            <span className="text-muted-foreground">(on this page)</span>
          </Label>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Sign in to see who is online right now.</p>
      )}
      <Table>
        <caption className="sr-only">MNNIT players</caption>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Player</TableHead>
            <TableHead>
              {TIME_CLASS_LABEL[timeClass]} rating{" "}
              <span className="font-normal normal-case">(imported)</span>
            </TableHead>
            <TableHead className="text-right">College games</TableHead>
            <TableHead className="text-right">Wins</TableHead>
            <TableHead
              className="text-right"
              title="Wins ÷ college games played (draws count as games)"
            >
              Win rate
            </TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.map((p) => {
            const ability: ChallengeAbility = !viewerId
              ? "signed_out"
              : p.user_id === viewerId
                ? "self"
                : viewerApproved
                  ? "ok"
                  : "not_approved";
            return (
              <TableRow key={p.user_id}>
                <TableCell>
                  <Link
                    href={`/players/${p.chess_username}`}
                    className="group flex items-center gap-3"
                  >
                    <PlayerAvatar name={p.display_name} src={p.avatar_url} />
                    <span className="grid leading-tight">
                      <span className="font-medium group-hover:underline">{p.display_name}</span>
                      <span className="text-xs text-muted-foreground">@{p.chess_username}</span>
                    </span>
                  </Link>
                </TableCell>
                <TableCell>
                  <RatingBadge rating={p.chess_rating} timeClass={timeClass} />
                </TableCell>
                <TableCell className="tabular text-right font-mono text-sm">
                  {p.games_played}
                </TableCell>
                <TableCell className="tabular text-right font-mono text-sm">{p.wins}</TableCell>
                <TableCell
                  className="tabular text-right font-mono text-sm"
                  title={
                    p.games_played
                      ? `${p.wins} wins in ${p.games_played} games`
                      : "No verified college games yet"
                  }
                >
                  {p.games_played ? formatPercent(Number(p.win_rate)) : "—"}
                </TableCell>
                <TableCell>
                  <div className="grid gap-1">
                    <PresenceDot userId={p.user_id} />
                    {!p.open_to_challenges ? (
                      <Badge variant="neutral">Not taking challenges</Badge>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  {p.open_to_challenges || ability === "self" ? (
                    <ChallengeButton
                      recipientId={p.user_id}
                      recipientName={p.display_name}
                      options={options}
                      ability={ability}
                    />
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {visible.length === 0 && rows.length > 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Nobody on this page is online right now.
        </p>
      ) : null}
    </div>
  );
}
