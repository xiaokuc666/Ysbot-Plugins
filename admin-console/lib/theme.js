import fs from "node:fs/promises";
import path from "node:path";
import { httpError } from "./plg.js";

export const DEFAULT_THEME = {
  bg: "#f4f6f8",
  surface: "#ffffff",
  border: "#d6dde3",
  text: "#1f2933",
  muted: "#64748b",
  primary: "#2563eb",
  danger: "#b91c1c",
  radius: "6px",
  font: 'system-ui, -apple-system, "Segoe UI", sans-serif',
};

export const THEME_PRESETS = {
  default: DEFAULT_THEME,
  dark: {
    bg: "#0f172a",
    surface: "#1e293b",
    border: "#334155",
    text: "#e2e8f0",
    muted: "#94a3b8",
    primary: "#38bdf8",
    danger: "#f87171",
    radius: "6px",
    font: DEFAULT_THEME.font,
  },
  ocean: {
    bg: "#eef7fb",
    surface: "#ffffff",
    border: "#c7e4f0",
    text: "#16323f",
    muted: "#5b7c8a",
    primary: "#0e7490",
    danger: "#b91c1c",
    radius: "8px",
    font: DEFAULT_THEME.font,
  },
  highContrast: {
    bg: "#ffffff",
    surface: "#ffffff",
    border: "#000000",
    text: "#000000",
    muted: "#222222",
    primary: "#0000cc",
    danger: "#cc0000",
    radius: "0px",
    font: DEFAULT_THEME.font,
  },
  midnight: {
    bg: "#0b1020",
    surface: "#161d33",
    border: "#2a3550",
    text: "#e6ebff",
    muted: "#8d99c4",
    primary: "#6d8dff",
    danger: "#ff6b81",
    radius: "8px",
    font: DEFAULT_THEME.font,
  },
  forest: {
    bg: "#f1f7f2",
    surface: "#ffffff",
    border: "#cfe3d3",
    text: "#1d2e20",
    muted: "#5f7965",
    primary: "#2f7d4f",
    danger: "#b42318",
    radius: "6px",
    font: DEFAULT_THEME.font,
  },
  sunset: {
    bg: "#fff4ec",
    surface: "#ffffff",
    border: "#f4d4c0",
    text: "#3a231a",
    muted: "#8a6250",
    primary: "#d95d39",
    danger: "#b3261e",
    radius: "10px",
    font: DEFAULT_THEME.font,
  },
  mono: {
    bg: "#111111",
    surface: "#1a1a1a",
    border: "#3a3a3a",
    text: "#f5f5f5",
    muted: "#9a9a9a",
    primary: "#d4d4d4",
    danger: "#ff5252",
    radius: "0px",
    font: DEFAULT_THEME.font,
  },
  azure: {
    bg: "#eef6ff",
    surface: "#ffffff",
    border: "#c6dff5",
    text: "#10233b",
    muted: "#5d7a99",
    primary: "#0f6fde",
    danger: "#d92d20",
    radius: "8px",
    font: DEFAULT_THEME.font,
  },
};

const COLOR_KEYS = [
  "bg",
  "surface",
  "border",
  "text",
  "muted",
  "primary",
  "danger",
];

function themeFile(ctx) {
  return path.join(ctx.dataDir, "theme.json");
}

export async function loadTheme(ctx) {
  let raw = {};
  try {
    raw = JSON.parse(await fs.readFile(themeFile(ctx), "utf8"));
  } catch {
    raw = {};
  }
  const preset = THEME_PRESETS[raw.preset] || DEFAULT_THEME;
  return {
    preset: raw.preset || "default",
    ...preset,
    ...(raw.colors || {}),
    ...(raw.radius ? { radius: raw.radius } : {}),
    ...(raw.font ? { font: raw.font } : {}),
  };
}

export async function saveTheme(ctx, input = {}) {
  const preset = input.preset || "default";
  if (!THEME_PRESETS[preset] && preset !== "custom") {
    throw httpError(400, `Unknown theme preset: ${preset}`);
  }
  const colors = {};
  for (const key of COLOR_KEYS) {
    if (typeof input.colors?.[key] === "string" && input.colors[key].trim()) {
      colors[key] = input.colors[key].trim();
    }
  }
  const data = {
    preset,
    colors,
    ...(typeof input.radius === "string" && input.radius.trim()
      ? { radius: input.radius.trim() }
      : {}),
    ...(typeof input.font === "string" && input.font.trim()
      ? { font: input.font.trim() }
      : {}),
  };
  const file = themeFile(ctx);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return loadTheme(ctx);
}

export function themeCss(theme = DEFAULT_THEME) {
  const t = { ...DEFAULT_THEME, ...theme };
  return `:root {
  --ysbot-bg: ${t.bg};
  --ysbot-surface: ${t.surface};
  --ysbot-border: ${t.border};
  --ysbot-text: ${t.text};
  --ysbot-muted: ${t.muted};
  --ysbot-primary: ${t.primary};
  --ysbot-danger: ${t.danger};
  --ysbot-radius: ${t.radius};
  --ysbot-font: ${t.font};
}`;
}
