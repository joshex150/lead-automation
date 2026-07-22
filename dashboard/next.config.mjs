/** @type {import('next').NextConfig} */
const nextConfig = {
  // Run via `next start` (not standalone), so the exact same start command
  // works whether Railway builds with a Dockerfile or with its own builder.
  reactStrictMode: true,
};

export default nextConfig;
