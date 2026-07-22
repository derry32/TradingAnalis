import type { Metadata } from "next";
import { Share_Tech_Mono } from "next/font/google";
import "./globals.css";

const shareTech = Share_Tech_Mono({
  weight: '400',
  variable: "--font-share-tech",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Trading Analis",
  description: "AI-Powered XAU/USD Price Action Trading Platform",
};

import { SystemHealthProvider } from "../components/SystemHealthProvider";
import { Toaster } from "sonner";

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
      <body className="min-h-full flex flex-col">
        <SystemHealthProvider>
          {children}
          <Toaster position="bottom-right" theme="dark" />
        </SystemHealthProvider>
      </body>
    </html>
  );
}
