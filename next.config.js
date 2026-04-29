/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['sharp'],
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push('sharp');
    }

    config.resolve = config.resolve || {};
    config.resolve.fallback = config.resolve.fallback || {};
    config.resolve.fallback = {
      ...config.resolve.fallback,
      sharp: false,
    };

    return config;
  },
};

module.exports = nextConfig;
