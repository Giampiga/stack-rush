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

  return {
    metadataBase: new URL(origin),
    title: "Peg Rush — Multiplayer Tower of Hanoi",
    description:
      "Challenge someone online and race a live Tower of Hanoi match. No account needed.",
    applicationName: "Peg Rush",
    openGraph: {
      title: "Peg Rush — Race the Tower",
      description: "Pick a rival. Stack faster. No account needed.",
      type: "website",
      images: [
        {
          url: "/og.png",
          width: 1731,
          height: 909,
          alt: "Peg Rush — Pick a rival. Race the puzzle.",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "Peg Rush — Race the Tower",
      description: "Pick a rival. Stack faster. No account needed.",
      images: ["/og.png"],
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
