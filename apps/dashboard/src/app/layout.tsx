import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { LiveRefresh } from "@/components/LiveRefresh";
import { NavBar } from "@/components/NavBar";
import { RegisterServiceWorker } from "@/components/RegisterServiceWorker";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Watchfire-Dashboard",
  description: "Real-time view of Watchfire — findings, runs, mutes, cost, adapter health.",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  themeColor: "#0b0d12",
  width: "device-width",
  initialScale: 1,
  // Disable user pinch-zoom on the PWA shell — keeps the bottom-tab
  // layout stable on mobile. Content remains accessible because
  // browser accessibility zoom still works.
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-zinc-950 text-zinc-100">
        <NavBar />
        {children}
        {/* Spacer so the last row of any page clears the fixed mobile
            bottom bar. Must sit AFTER {children} to reserve space below
            the content — inside NavBar (rendered before children) it
            padded the top instead, letting the last rows slide under
            the bar when scrolling. */}
        <div className="h-16 md:hidden" aria-hidden />
        <LiveRefresh />
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
