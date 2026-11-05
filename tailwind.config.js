/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1f2033",
        sidebar: "#232145",
        sidebarHover: "#2d2a55",
        accent: "#6c5ce7",
        accentSoft: "#efedfd",
        canvas: "#f6f6f9",
        line: "#eceaf3",
        muted: "#8b8aa3",
      },
      boxShadow: { card: "0 1px 2px rgba(24,22,46,.05), 0 1px 3px rgba(24,22,46,.04)" },
      borderRadius: { xl2: "14px" },
    },
  },
  plugins: [],
};
