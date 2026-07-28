/** @type {import('next').NextConfig} */
const nextConfig = {
  // The upstream feeds this app reads are only ever touched from server
  // components. lib/upstream.ts and lib/grid.ts both carry `import 'server-only'`,
  // so a client component that pulls one in fails the build rather than shipping
  // a NOAA request to a browser. That enforcement lives in the modules, not here.
  reactStrictMode: true,
};

export default nextConfig;
