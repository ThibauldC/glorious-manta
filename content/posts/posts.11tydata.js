export default {
  layout: "post.njk",
  eleventyComputed: {
    permalink: ({ page }) =>
      `/posts/${page.fileSlug.replace(/^\d{4}-\d{2}-\d{2}-/, "")}/index.html`,
    description: ({ title }) => `${title} — Thibauld Croonenborghs`,
  },
};
