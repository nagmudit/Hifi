import type { ReactNode } from "react";

export const metadata = {
  title: "HiFi",
  description: "Ship code from Discord.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif",
          background: "#0b0c0f",
          color: "#e9eaee",
        }}
      >
        {children}
      </body>
    </html>
  );
}
