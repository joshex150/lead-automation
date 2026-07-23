import type { Metadata, Viewport } from "next";
import { DM_Sans, Space_Grotesk } from "next/font/google";
import { Toaster } from "react-hot-toast";
import { Sidebar } from "@/components/Sidebar";
import { OnboardingGate } from "@/components/OnboardingGate";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-space-grotesk" });
const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-dm-sans" });

export const metadata: Metadata = {
  title: "YEAN Leads, approval dashboard",
  description: "Semi-automated lead generation for YEAN Technologies",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${dmSans.variable}`}>
      <body>
        <OnboardingGate>
          <div className="app-shell flex">
            <Sidebar />
            <main className="app-main min-w-0 flex-1 overflow-x-hidden px-4 pb-16 pt-20 sm:px-6 lg:px-8 lg:pt-8">
              {children}
            </main>
          </div>
        </OnboardingGate>
        <Toaster
          position="top-right"
          toastOptions={{
            className: "!border !border-slate-700 !bg-slate-900 !text-white dark:!border-slate-200 dark:!bg-white dark:!text-slate-900",
          }}
        />
      </body>
    </html>
  );
}
