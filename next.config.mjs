/** @type {import('next').NextConfig} */
const nextConfig = {
  // The upstream feeds this app reads (CO-OPS, NDBC) are only ever touched from
  // server components and route handlers. Nothing in lib/coops.ts or
  // lib/ndbc.ts may reach a browser bundle; both import 'server-only' so a
  // client component that pulls them in fails the build rather than shipping a
  // NOAA request to the client.
  reactStrictMode: true,
  experimental: {
    // shared/ lives outside app/ and lib/ and is imported by both this app and
    // (eventually) other consumers. Nothing special is needed to read it at
    // build time, but keeping it listed documents the dependency.
    typedRoutes: true,
  },
};

export default nextConfig;
