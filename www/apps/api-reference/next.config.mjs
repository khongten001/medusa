import mdx from "@next/mdx"
import bundleAnalyzer from "@next/bundle-analyzer"

/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return {
      fallback: [
        {
          source: "/ui",
          destination: `${process.env.NEXT_PUBLIC_UI_URL}/ui`,
        },
        {
          source: "/ui/:path*",
          destination: `${process.env.NEXT_PUBLIC_UI_URL}/ui/:path*`,
        },
        // TODO uncomment for v2
        // {
        //   source: "/v2",
        //   destination: `${process.env.NEXT_PUBLIC_DOCS_V2_URL}/resources`,
        // },
        // {
        //   source: "/v2/:path*",
        //   destination: `${process.env.NEXT_PUBLIC_DOCS_V2_URL}/resources/:path*`,
        // },
        {
          source: "/:path*",
          destination: `${process.env.NEXT_PUBLIC_DOCS_URL}/:path*`,
        },
      ],
    }
  },
  webpack: (config) => {
    config.ignoreWarnings = [{ module: /node_modules\/keyv\/src\/index\.js/ }]

    return config
  },
  transpilePackages: ["docs-ui"],
}

const withMDX = mdx({
  extension: /\.mdx?$/,
  options: {
    rehypePlugins: [],
    development: process.env.NODE_ENV === "development",
  },
})

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE_BUNDLE === "true",
})

export default withBundleAnalyzer(withMDX(nextConfig))
