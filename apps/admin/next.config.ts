/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@viora/domain"],
  experimental: {
    externalDir: true,
  },
};

export default nextConfig;
