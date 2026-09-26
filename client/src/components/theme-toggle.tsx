import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/theme-provider";

/**
 * Theme switch. Lives in the shell header, so on a coarse pointer it takes the
 * 44px floor (G1(c)): the shared `size="icon"` step is 36px, which is under the
 * product's own touch-target bar. Scoped to `pointer: coarse` so the desktop
 * header keeps its 36px density.
 */
export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <Button
      size="icon"
      variant="ghost"
      onClick={toggleTheme}
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      data-testid="button-theme-toggle"
      className="[@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
    >
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
