import * as React from "react";
import { cn } from "@/lib/utils";

export interface PageHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  description?: string;
  action?: React.ReactNode;
  testId?: string;
  titleTestId?: string;
}

/**
 * Canonical PageHeader established in Phase 28.2B.
 * Provides consistent product-level title, optional description, primary action,
 * and standard spacing across canonical destinations.
 */
export function PageHeader({
  title,
  description,
  action,
  testId = "page-header",
  titleTestId = "text-page-title",
  className,
  children,
  ...props
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 border-b bg-background/95 sticky top-0 z-10 backdrop-blur supports-[backdrop-filter]:bg-background/60",
        className
      )}
      data-testid={testId}
      {...props}
    >
      <div className="space-y-0.5 min-w-0">
        <h1 className="text-lg font-semibold tracking-tight truncate" data-testid={titleTestId}>
          {title}
        </h1>
        {description && (
          <p className="text-xs text-muted-foreground" data-testid="text-page-description">
            {description}
          </p>
        )}
      </div>
      {(action || children) && (
        <div className="flex items-center gap-2 shrink-0">
          {action}
          {children}
        </div>
      )}
    </div>
  );
}
