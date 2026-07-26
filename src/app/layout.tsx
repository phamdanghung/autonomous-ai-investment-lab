import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Autonomous AI Investment Lab",
  description: "Phase 1A Implementation",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
