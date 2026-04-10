/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          base: "var(--bg-base)",
          panel: "var(--bg-panel)",
          elevated: "var(--bg-elevated)",
          DEFAULT: "var(--bg-surface)",
          hover: "var(--bg-hover)"
        },
        border: {
          subtle: "var(--border-subtle)",
          DEFAULT: "var(--border)",
          strong: "var(--border-strong)"
        },
        accent: {
          DEFAULT: "var(--accent)",
          hover: "var(--accent-hover)",
          muted: "var(--accent-muted)",
          glow: "var(--accent-glow)"
        },
        ink: {
          primary: "var(--text-primary)",
          secondary: "var(--text-secondary)",
          muted: "var(--text-muted)",
          ghost: "var(--text-ghost)"
        },
        success: "var(--success)",
        warning: "var(--warning)",
        danger: "var(--danger)",
        info: "var(--info)"
      },
      animation: {
        "fade-in": "fadeIn 0.18s ease-out",
        "slide-up": "slideUp 0.2s ease-out",
        "slide-in-right": "slideInRight 0.22s ease-out",
        "glow-pulse": "glowPulse 2.4s ease-in-out infinite",
        "shimmer": "shimmer 1.6s ease-in-out infinite"
      },
      keyframes: {
        fadeIn: {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" }
        },
        slideUp: {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" }
        },
        slideInRight: {
          from: { opacity: "0", transform: "translateX(12px)" },
          to: { opacity: "1", transform: "translateX(0)" }
        },
        glowPulse: {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(37,99,235,0)" },
          "50%": { boxShadow: "0 0 14px 3px rgba(37,99,235,0.28)" }
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% center" },
          "100%": { backgroundPosition: "200% center" }
        }
      },
      boxShadow: {
        "glow-sm": "0 0 8px 1px rgba(37,99,235,0.25)",
        "glow-md": "0 0 16px 3px rgba(37,99,235,0.3)",
        "panel": "0 8px 32px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.04) inset",
        "modal": "0 24px 80px rgba(0,0,0,0.8), 0 1px 0 rgba(255,255,255,0.06) inset"
      }
    }
  },
  plugins: []
}
