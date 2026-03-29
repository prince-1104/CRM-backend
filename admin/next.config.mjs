/** @type {import('next').NextConfig} */
const nextConfig = {
  // Avoid double useEffect runs in dev (each page would hit the API twice on load).
  reactStrictMode: false,
};

export default nextConfig;
