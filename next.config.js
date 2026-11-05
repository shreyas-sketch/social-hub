/** @type {import('next').NextConfig} */
module.exports = {
  experimental: {
    serverComponentsExternalPackages: ["better-sqlite3"],
    serverActions: { bodySizeLimit: "4mb" },
  },
};
