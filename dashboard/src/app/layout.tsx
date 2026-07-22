import type { Metadata, Viewport } from "next";
import { DM_Sans, Space_Grotesk } from "next/font/google";
import { Toaster } from "react-hot-toast";
import { Sidebar } from "@/components/Sidebar";
import { AnimatedBackground } from "@/lib/motion";
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
        <div className="relative min-h-screen">
          <AnimatedBackground />
          <div className="flex">
            <Sidebar />
            {/* min-w-0 lets wide tables scroll inside their own container
                instead of stretching the page sideways on small screens. */}
            <main className="min-h-screen min-w-0 flex-1 overflow-x-clip px-4 pb-16 pt-6 sm:px-8 lg:px-10">
              {children}
            </main>
          </div>
        </div>
        <Toaster
          position="top-right"
          toastOptions={{
            className: "!rounded-xl !bg-slate-900 !text-white dark:!bg-white dark:!text-slate-900",
          }}
        />
      </body>
    </html>
  );
}
