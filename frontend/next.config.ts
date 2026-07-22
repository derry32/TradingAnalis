import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://43.156.79.235:3002/api/:path*',
      },
    ];
  },
};

export default nextConfig;
