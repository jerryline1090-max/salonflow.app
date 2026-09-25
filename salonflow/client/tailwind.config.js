/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: "#111111",
          soft: "#373737",
          muted: "#5A5A5A",
        },
        paper: {
          DEFAULT: "#F7F2E8",
          raised: "#FAFAF8",
          sunken: "#EEE7DA",
        },
        line: {
          DEFAULT: "#E2DBD0",
          soft: "#EEE9E1",
        },
        brass: {
          50: "#F3EDFA",
          100: "#E3D7F2",
          300: "#B89CD6",
          500: "#6A3FB6",
          600: "#57339A",
          700: "#45277B"
        },
        pine: {
          50: "#E9F0EC",
          100: "#CBDED4",
          300: "#7FA895",
          500: "#2F4A43",
          600: "#243A34",
          700: "#1A2A26"
        },
        success: { DEFAULT: "#3F7A5C", bg: "#E7F1EB" },
        warning: { DEFAULT: "#B5811F", bg: "#FBF1DD" },
        danger: { DEFAULT: "#B4443A", bg: "#FBEAE8" },
        info: { DEFAULT: "#3B6B93", bg: "#E9F1F7" }
      },
      fontFamily: {
        display: ["'Fraunces'", "Georgia", "serif"],
        sans: ["'Plus Jakarta Sans'", "system-ui", "sans-serif"]
      },
      borderRadius: {
        sm: "6px",
        DEFAULT: "10px",
        lg: "14px"
      },
      boxShadow: {
        card: "0 1px 2px rgba(34, 28, 26, 0.06), 0 1px 0 rgba(34, 28, 26, 0.03)",
        popover: "0 12px 32px rgba(34, 28, 26, 0.14)"
      }
    }
  },
  plugins: []
};
