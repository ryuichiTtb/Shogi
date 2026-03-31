import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "将棋 - AI対局",
    short_name: "将棋",
    description: "AIと将棋を楽しもう",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f0e1",
    theme_color: "#f5f0e1",
    orientation: "any",
    categories: ["games", "entertainment"],
    icons: [
      {
        src: "/icons/icon-192x192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icons/icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/icons/icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
