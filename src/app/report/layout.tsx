import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "The Golden Key",
};

export default function ReportLayout({ children }: LayoutProps<"/report">) {
  return children;
}
