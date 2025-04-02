/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "#f8f9fa",
        "dark-gray": {
          DEFAULT: "#2d3748",
          light: "#4a5568",
        },
        ton: {
          DEFAULT: "#0088cc",
          light: "#3aa8e0",
          dark: "#006699",
        },
        success: "#10b981",
        warning: "#f59e0b",
        danger: "#ef4444",
      },
      fontFamily: {
        sans: ["Inter", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      boxShadow: {
        sm: "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
        DEFAULT: "0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)",
      },
      gridTemplateColumns: {
        "dashboard": "repeat(12, minmax(0, 1fr))",
      },
      spacing: {
        "card": "24px",
      },
    },
  },
  plugins: [],
}