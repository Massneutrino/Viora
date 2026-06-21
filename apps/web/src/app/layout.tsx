import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Viora — Employer",
  description: "Tell V what you need. AI-native staffing for schools.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
