import "./styles.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Meet your Deepline expert",
  description: "Realtime, CRM-aware inbound routing.",
};

export default function Layout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
