/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@per-scholas/scoring', '@per-scholas/taxonomy'],
  experimental: {
    serverActions: { allowedOrigins: ['*.vercel.app', 'localhost:3000'] },
  },
};
export default nextConfig;
