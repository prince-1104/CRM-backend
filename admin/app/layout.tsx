import type { Metadata } from "next";
import { Manrope, Space_Grotesk } from "next/font/google";
import "./globals.css";

const fontHeadline = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-headline",
});

const fontBody = Manrope({
  subsets: ["latin"],
  variable: "--font-body",
});

export const metadata: Metadata = {
  title: "Star Uniform Admin",
  description: "Star Uniform administration",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`dark ${fontHeadline.variable} ${fontBody.variable}`}
    >
      <body
        className={`${fontBody.className} min-h-screen bg-background font-body text-on-surface antialiased selection:bg-primary/30`}
      >
        {children}
      </body>
    </html>
  );
}
