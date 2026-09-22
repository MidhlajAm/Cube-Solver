import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /**
   * The dev server blocks cross-origin requests to dev-only assets, allowing
   * only localhost and the hostname it was started with. Phone testing goes
   * through a Cloudflare quick tunnel, so that hostname has to be allowed too —
   * without it the page serves its HTML but never hydrates, leaving a dead UI
   * stuck on its initial state with nothing logged to explain why.
   */
  allowedDevOrigins: ['*.trycloudflare.com', '*.ngrok-free.app', '*.loca.lt'],
};

export default nextConfig;
