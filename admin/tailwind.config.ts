import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "#0b0e14",
        surface: "#0b0e14",
        "surface-dim": "#0b0e14",
        "surface-bright": "#282c36",
        "surface-container": "#161a21",
        "surface-container-low": "#10131a",
        "surface-container-high": "#1c2028",
        "surface-container-highest": "#22262f",
        "on-background": "#ecedf6",
        "on-surface": "#ecedf6",
        "on-surface-variant": "#a9abb3",
        primary: "#a1faff",
        "primary-dim": "#00e5ee",
        "on-primary": "#006165",
        "secondary": "#d873ff",
        "tertiary": "#bcff5f",
        error: "#ff716c",
        outline: "#73757d",
        "outline-variant": "#45484f",
      },
      fontFamily: {
        headline: ["var(--font-headline)", "system-ui", "sans-serif"],
        body: ["var(--font-body)", "system-ui", "sans-serif"],
      },
      borderRadius: {
        lg: "0.5rem",
        xl: "0.75rem",
        "3xl": "1.5rem",
      },
    },
  },
  plugins: [],
};

export default config;
