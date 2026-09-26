import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The one surface treatment for the product's "nothing here / nothing loaded"
 * regions.
 *
 * `EmptyState` and `ErrorState` are one family (design direction §5.2): the same
 * dashed boundary, the same radius, the same padding. That surface used to be
 * copy-pasted between the two components, which is how a second visual language
 * starts — the pages already hand-roll `rounded-lg border border-dashed p-8`
 * empties next to the `rounded-md` shared one.
 *
 * This is an internal building block, not a component to consume directly: use
 * `EmptyState` for a true empty result and `ErrorState` for a failed read.
 */
export const STATE_SURFACE_CLASS =
  "flex flex-col items-center justify-center gap-2 rounded-md border border-dashed p-8 text-center";

export type StateSurfaceProps = React.HTMLAttributes<HTMLDivElement>;

export function StateSurface({ className, ...props }: StateSurfaceProps) {
  return <div className={cn(STATE_SURFACE_CLASS, className)} {...props} />;
}
