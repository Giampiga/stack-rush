import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const forwardedProtocol = requestHeaders.get("x-forwarded-proto");
  const protocol = forwardedProtocol ?? (host?.startsWith("localhost") ? "http" : "https");
  const origin = host ? `${protocol}://${host}` : "http://localhost:3000";
  const socialImage = new URL("/og.png", origin).toString();

  return {
    metadataBase: new URL(origin),
    title: "Peg Rush — Live Multiplayer Puzzle Races",
    description:
      "Challenge someone online to a live nut-sort or Tower of Hanoi race. No account needed.",
    applicationName: "Peg Rush",
    openGraph: {
      title: "Peg Rush — Race the Puzzle",
      description: "Pick a rival. Choose a puzzle. No account needed.",
      type: "website",
      images: [{ url: socialImage, width: 1536, height: 1024, alt: "Peg Rush Nut Sort versus Tower Race" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Peg Rush — Race the Puzzle",
      description: "Pick a rival. Choose a puzzle. No account needed.",
      images: [socialImage],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
