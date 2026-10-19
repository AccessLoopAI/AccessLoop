import type { Metadata, Viewport } from "next";
import { Suspense, type ReactNode } from "react";
import { RouteFocus } from "@/components/layout/RouteFocus";
import { SkipLink } from "@/components/ui/SkipLink";
import { StatusRegionProvider } from "@/components/ui/StatusRegion";
import { fontVariables } from "./font-faces";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "AccessLoop", template: "%s | AccessLoop" },
  description:
    "Accessibility feedback for the Accessible Canada Act: every barrier is closed only when the person who reported it confirms the fix.",
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f3ed" },
    { media: "(prefers-color-scheme: dark)", color: "#1b1916" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={fontVariables}>
      <body>
        <SkipLink />
        <StatusRegionProvider>
          {/* RouteFocus reads the search params (useSearchParams), which needs a Suspense boundary on static pages;
              it renders nothing, so the fallback is nothing too. */}
          <Suspense fallback={null}>
            <RouteFocus />
          </Suspense>
          {children}
        </StatusRegionProvider>
      </body>
    </html>
  );
}
