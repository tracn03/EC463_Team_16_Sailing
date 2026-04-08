import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BO-AT Mission Planner",
  description: "Autonomous boat mission planning and control system",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
