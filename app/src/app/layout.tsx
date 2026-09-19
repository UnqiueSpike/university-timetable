import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sign in · UniSchedule",
  description: "Your university timetable, in one place. Sign in to your university timetable.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className="antialiased"><body>{children}</body></html>;
}
