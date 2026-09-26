import { useMemo } from "react";
import { useTheme } from "@/components/theme-provider";

const CHART_COLOR_VARS = [
  "--chart-1",
  "--chart-2",
  "--chart-3",
  "--chart-4",
  "--chart-5",
] as const;

/**
 * Resolved chart series colors for the active theme.
 *
 * Recharts renders SVG, which needs a concrete color string and cannot read
 * `hsl(var(--chart-N))` itself. These values used to be hardcoded hex in
 * `analytics.tsx` and `ai-usage.tsx`, which meant every chart ignored dark
 * mode and none of them used the ramp the design system already defined.
 *
 * The ramp separates by lightness first, so series stay distinguishable under
 * deuteranopia and protanopia rather than relying on hue alone.
 *
 * Memoized on `theme` because a chart re-rendering its series on every keystroke
 * of a filter is exactly the kind of unnecessary work this product avoids.
 */
export function useChartColors(): string[] {
  const { theme } = useTheme();
  return useMemo(() => {
    if (typeof window === "undefined") return [];
    const root = getComputedStyle(document.documentElement);
    const probe = document.createElement("div");
    probe.style.display = "none";
    document.body.appendChild(probe);
    const colors = CHART_COLOR_VARS.map((name) => {
      probe.style.color = `hsl(${root.getPropertyValue(name).trim()})`;
      return getComputedStyle(probe).color;
    });
    probe.remove();
    return colors;
    // `theme` is the dependency: the tokens only change when the class flips.
  }, [theme]);
}

/**
 * Axis and label sizing for charts.
 *
 * 12px is the floor, matching `--text-meta` in `index.css`. Recharts ticks were
 * at 9-10px, below what the rest of the app is allowed to use and unreadable in
 * a dense comparison view.
 */
export const CHART_TICK_FONT_SIZE = 12;
