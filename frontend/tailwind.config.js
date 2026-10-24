/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: { sans: ["Inter", "system-ui", "Segoe UI", "sans-serif"], mono: ["JetBrains Mono", "ui-monospace", "monospace"] },
      colors: {
        primary: { 50: "#eff5ff", 100: "#dbe7fe", 200: "#bfd3fe", 500: "#2563eb", 600: "#1d4fd8", 700: "#1e3fae" },
        page: "#f4f6fa",
        series: { opt: "#2a78d6", base: "#eb6834", aqua: "#1baf7a" },
        status: { good: "#0ca30c", warning: "#fab219", serious: "#ec835a", critical: "#d03b3b" },
      },
      boxShadow: { card: "0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.06)" },
    },
  },
  plugins: [],
};
