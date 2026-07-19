import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppQueryProvider } from "@/hooks/queryClient";
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
  title: "AVIS Fleet Management",
  description: "Outil interne de gestion de flotte — DS History, Suivi Atelier, Parking, BDD.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <AppQueryProvider>{children}</AppQueryProvider>
      </body>
    </html>
  );
}
