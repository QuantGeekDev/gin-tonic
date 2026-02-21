"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

const THEMES = [
  { id: "dark", label: "Dark" },
  { id: "light", label: "Light" },
  { id: "system", label: "System" },
] as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <Button variant="outline" size="sm" disabled>
        Theme
      </Button>
    );
  }

  return (
    <div className="inline-flex items-center rounded-md border border-input bg-background p-1">
      {THEMES.map((themeOption) => (
        <Button
          key={themeOption.id}
          type="button"
          size="sm"
          variant={theme === themeOption.id ? "default" : "ghost"}
          className="h-8 px-2 text-xs"
          onClick={() => setTheme(themeOption.id)}
        >
          {themeOption.label}
        </Button>
      ))}
    </div>
  );
}
