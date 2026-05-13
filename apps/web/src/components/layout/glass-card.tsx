import { cn } from "@/lib/utils";
import type { HTMLAttributes, ReactNode } from "react";

interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  variant?: "default" | "strong";
  hover?: boolean;
}

export function GlassCard({
  children,
  variant = "default",
  hover = false,
  className,
  ...props
}: GlassCardProps) {
  return (
    <div
      className={cn(
        variant === "default" ? "glass" : "glass-strong",
        hover && "glass-hover transition-colors",
        "p-6",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}