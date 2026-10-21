import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { AlertTriangle, CheckCircle2, Info, XOctagon } from "lucide-react";
import { cn } from "@/lib/utils";

const alertVariants = cva(
  "relative flex gap-3 rounded-lg border p-4 text-sm [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0",
  {
    variants: {
      variant: {
        info: "border-info/30 bg-info/5 [&>svg]:text-info",
        success: "border-success/30 bg-success/5 [&>svg]:text-success",
        warning: "border-warning/30 bg-warning/5 [&>svg]:text-warning",
        danger: "border-danger/30 bg-danger/5 [&>svg]:text-danger",
      },
    },
    defaultVariants: { variant: "info" },
  },
);

const icons = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XOctagon,
} as const;

export function Alert({
  className,
  variant = "info",
  title,
  children,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants> & { title?: string }) {
  const Icon = icons[variant ?? "info"];
  return (
    <div
      role={variant === "danger" || variant === "warning" ? "alert" : "status"}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    >
      <Icon aria-hidden />
      <div className="grid gap-1">
        {title ? <p className="leading-tight font-medium">{title}</p> : null}
        {children ? <div className="text-muted-foreground">{children}</div> : null}
      </div>
    </div>
  );
}
