import { CheckCircle2, Circle, Clock3 } from "lucide-react";
import { cn } from "@/lib/utils";

export type StepState = "done" | "pending" | "todo";

export interface ChecklistItem {
  label: string;
  state: StepState;
  detail: string;
}

/** The four separate verification facts, shown plainly and never conflated. */
export function StatusChecklist({ items }: { items: ChecklistItem[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2" aria-label="Verification status">
      {items.map((item) => (
        <li key={item.label} className="flex gap-3 rounded-lg border bg-card p-4">
          {item.state === "done" ? (
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-label="Complete" />
          ) : item.state === "pending" ? (
            <Clock3 className="mt-0.5 size-5 shrink-0 text-warning" aria-label="In progress" />
          ) : (
            <Circle
              className="mt-0.5 size-5 shrink-0 text-muted-foreground"
              aria-label="Not done"
            />
          )}
          <div className="grid gap-0.5">
            <p
              className={cn(
                "text-sm font-medium",
                item.state === "todo" && "text-muted-foreground",
              )}
            >
              {item.label}
            </p>
            <p className="text-xs text-muted-foreground">{item.detail}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
