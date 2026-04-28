import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./client/index.html", "./client/src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      borderRadius: {
        lg: "var(--radius-lg)",
        md: "var(--radius)",
        sm: "var(--radius-sm)",
        xl: "var(--radius-xl)",
      },
      colors: {
        // ── shadcn semantic tokens (existing components) ──────────────
        background: "var(--background)",
        foreground: "var(--foreground)",
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)",
        },
        popover: {
          DEFAULT: "var(--popover)",
          foreground: "var(--popover-foreground)",
        },
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)",
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-foreground)",
        },
        destructive: {
          DEFAULT: "var(--destructive)",
          foreground: "var(--destructive-foreground)",
        },
        success: "var(--success)",
        warning: "var(--warning)",
        info: "var(--info)",
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        chart: {
          "1": "var(--chart-1)",
          "2": "var(--chart-2)",
          "3": "var(--chart-3)",
          "4": "var(--chart-4)",
          "5": "var(--chart-5)",
        },

        // ── Otto raw tokens — for new mockup-driven UI ─────────────────
        // Use as `bg-paper`, `text-ink`, `border-line`, `bg-otto-accent` etc.
        paper: "var(--paper)",
        "paper-2": "var(--paper-2)",
        panel: "var(--panel)",
        "panel-2": "var(--panel-2)",
        "panel-warm": "var(--panel-warm)",
        line: "var(--line)",
        "line-2": "var(--line-2)",
        "line-strong": "var(--line-strong)",
        ink: {
          DEFAULT: "var(--ink)",
          2: "var(--ink-2)",
          3: "var(--ink-3)",
          mute: "var(--ink-mute)",
          faint: "var(--ink-faint)",
        },
        "brand-navy": "var(--brand-navy)",
        "brand-navy-2": "var(--brand-navy-2)",
        "brand-emerald": "var(--brand-emerald)",
        "brand-emerald-2": "var(--brand-emerald-2)",
        "otto-accent": {
          DEFAULT: "var(--otto-accent)",
          strong: "var(--otto-accent-strong)",
          soft: "var(--otto-accent-soft)",
          line: "var(--otto-accent-line)",
          ink: "var(--otto-accent-ink)",
        },
        danger: {
          DEFAULT: "var(--danger)",
          bg: "var(--danger-bg)",
        },
        warn: {
          DEFAULT: "var(--warn)",
          bg: "var(--warn-bg)",
        },
      },
      fontFamily: {
        sans: ["var(--fa-ui)"],
        display: ["var(--fa-display)"],
        mono: ["var(--fa-mono)"],
      },
      fontSize: {
        // mockup uses 13px UI font; scale via --ui-scale density var
        ui: ["var(--font-ui)", { lineHeight: "1.45" }],
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        fadeIn: {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        slideInRight: {
          from: { transform: "translateX(100%)" },
          to: { transform: "translateX(0)" },
        },
        ottoFadeIn: {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        ottoPopIn: {
          from: { opacity: "0", transform: "translateY(8px) scale(0.985)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fadeIn 0.3s ease-in-out",
        "slide-in-right": "slideInRight 0.3s ease-out",
        "otto-fade-in": "ottoFadeIn 180ms ease-in-out",
        "otto-pop-in": "ottoPopIn 220ms cubic-bezier(.2,.8,.2,1)",
      },
      boxShadow: {
        soft: "var(--shadow-sm)",
        medium: "var(--shadow)",
        hard: "var(--shadow-lg)",
        xl: "var(--shadow-xl)",
        // legacy aliases used by existing components
        "soft-legacy": "0 2px 8px rgba(0, 0, 0, 0.08)",
      },
    },
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
} satisfies Config;
