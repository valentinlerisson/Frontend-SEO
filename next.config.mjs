/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // DuckDB (base des backlinks) est un module natif : chargé par Node, pas empaqueté
  serverExternalPackages: ['@duckdb/node-api', '@duckdb/node-bindings'],
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
