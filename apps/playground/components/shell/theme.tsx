"use client";

import { MoonStarIcon, SunIcon } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { Button } from "@/components/ui/button";

/**
 * Minimal class-based theme system (no runtime dependency): a blocking inline
 * script applies `.dark` before first paint, and this provider keeps React
 * state + localStorage in sync afterwards. Dark is the default theme.
 */

const STORAGE_KEY = "playground-theme";

type Theme = "dark" | "light";

const ThemeContext = createContext<{
  theme: Theme;
  toggle: () => void;
} | null>(null);

/** Inline `<script>` body — runs before hydration, so no theme flash. */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  STORAGE_KEY,
)});if(t!=="light"){document.documentElement.classList.add("dark")}}catch(e){document.documentElement.classList.add("dark")}})()`;

export function ThemeProvider({ children }: { readonly children: ReactNode }) {
  // The init script already applied the class; mirror it into state.
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    setTheme(
      document.documentElement.classList.contains("dark") ? "dark" : "light",
    );
  }, []);

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next = current === "dark" ? "light" : "dark";
      document.documentElement.classList.toggle("dark", next === "dark");
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Private mode: theme just won't persist.
      }
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}

export function ThemeToggle({ className }: { readonly className?: string }) {
  const { theme, toggle } = useTheme();
  return (
    <Button
      aria-label={
        theme === "dark" ? "Switch to light theme" : "Switch to dark theme"
      }
      className={className}
      onClick={toggle}
      size="icon-sm"
      type="button"
      variant="ghost"
    >
      {theme === "dark" ? (
        <SunIcon className="size-4" />
      ) : (
        <MoonStarIcon className="size-4" />
      )}
    </Button>
  );
}
