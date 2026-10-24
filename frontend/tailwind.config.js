/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: { sans: ["Inter", "system-ui", "Segoe UI", "sans-serif"], mono: ["JetBrains Mono", "ui-monospace", "monospace"] },
      colors: {
        brand: { 50: "#eef6f3", 100: "#d5ebe3", 500: "#1f7a5c", 600: "#17654b", 700: "#11503b", 900: "#0b2e23" },
        series: { opt: "#2a78d6", base: "#eb6834", aqua: "#1baf7a", violet: "#6250d6" },
        status: { good: "#0ca30c", warning: "#fab219", serious: "#ec835a", critical: "#d03b3b" },
      },
    },
  },
  plugins: [],
};
