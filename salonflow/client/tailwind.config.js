/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#F4F1FF",
          100: "#E9E2FF",
          300: "#B9A4F8",
          500: "#7047D8",
          600: "#5F37C4",
          700: "#4C2D9B",
        },
        sidebar: "#101828",
        workspace: "#F5F7FB",
        surface: "#FFFFFF",
        elevated: "#FFFFFF",
        border: "#E4E7EC",
        ink: {
          DEFAULT: "#172033",
          soft: "#344054",
          muted: "#667085",
        },
        paper: {
          DEFAULT: "#F5F7FB",
          raised: "#FFFFFF",
          sunken: "#EEF1F6",
        },
        line: {
          DEFAULT: "#E4E7EC",
          soft: "#F0F2F5",
        },
        brass: {
          50: "#F4F1FF",
          100: "#E9E2FF",
          300: "#B9A4F8",
          500: "#7047D8",
          600: "#5F37C4",
          700: "#4C2D9B"
        },
        pine: {
          50: "#E9F0EC",
          100: "#CBDED4",
          300: "#7FA895",
          500: "#2F4A43",
          600: "#243A34",
          700: "#1A2A26"
        },
        success: { DEFAULT: "#16794C", bg: "#EAF7EF" },
        warning: { DEFAULT: "#B54708", bg: "#FFF4E5" },
        danger: { DEFAULT: "#D92D20", bg: "#FFF0EF" },
        info: { DEFAULT: "#175CD3", bg: "#EEF4FF" }
      },
      fontFamily: {
        display: ["'Fraunces'", "Georgia", "serif"],
        sans: ["'Plus Jakarta Sans'", "system-ui", "sans-serif"]
      },
      borderRadius: {
        sm: "6px",
        DEFAULT: "10px",
        lg: "14px",
        xl: "18px"
      },
      boxShadow: {
        card: "0 1px 2px rgba(16, 24, 40, 0.04), 0 1px 3px rgba(16, 24, 40, 0.08)",
        popover: "0 16px 36px rgba(16, 24, 40, 0.16)"
      }
    }
  },
  plugins: []
};
