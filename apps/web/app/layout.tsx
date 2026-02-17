import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Jihn Dashboard",
  description: "Local dashboard for the Jihn agent runtime",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
