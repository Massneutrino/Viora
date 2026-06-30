/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NODE_ENV === "production" ? ".next-build" : ".next",
  transpilePackages: ["@viora/ui"],
};

export default nextConfig;
