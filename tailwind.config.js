/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          0: "#05080f",
          1: "#080d18",
          2: "#0c1423",
          3: "#101d30",
          4: "#152538"
        },
        border: {
          subtle: "#111d30",
          DEFAULT: "#1a2d45",
          strong: "#243f62"
        },
        accent: {
          DEFAULT: "#2563eb",
          hover: "#1d4ed8",
          muted: "rgba(37,99,235,0.12)",
          glow: "rgba(37,99,235,0.35)"
        },
        ink: {
          primary: "#e2e8f4",
          secondary: "#6b8fb5",
          muted: "#3a5272",
          ghost: "#1e3050"
        },
        success: "#10b981",
        warning: "#f59e0b",
        danger: "#e11d48"
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
