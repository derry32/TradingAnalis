import type { Metadata } from "next";
import { Share_Tech_Mono } from "next/font/google";
import "./globals.css";

const shareTech = Share_Tech_Mono({
  weight: '400',
  variable: "--font-share-tech",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CYBEREX_TERMINAL // GRID_STATUS: ACTIVE",
  description: "AI-Powered XAU/USD Price Action Trading Platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${shareTech.variable} h-full antialiased font-mono`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
