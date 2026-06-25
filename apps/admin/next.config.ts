/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@viora/domain", "@viora/ui"],
  experimental: {
    externalDir: true,
  },
};

export default nextConfig;
