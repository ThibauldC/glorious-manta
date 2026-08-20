import MarkdownIt from "markdown-it";

export default function (config) {
  const markdown = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true,
    highlight(code, language) {
      return language === "mermaid"
        ? `<pre class="mermaid">${markdown.utils.escapeHtml(code)}</pre>`
        : "";
    },
  });

  config.setLibrary("md", markdown);
  config.addGlobalData("currentYear", () => new Date().getFullYear());
  config.addPassthroughCopy({ public: "." });
  config.ignores.add("README.md");

  config.addCollection("posts", (collection) =>
    collection
      .getFilteredByGlob("./content/posts/*.md")
      .sort((a, b) => b.date - a.date),
  );

  config.addFilter("readableDate", (value) =>
    new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(value)),
  );
  config.addFilter("htmlDate", (value) =>
    new Date(value).toISOString().slice(0, 10),
  );
  config.addFilter("slug", (value) =>
    String(value)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, ""),
  );
  config.addFilter("allTags", (posts) =>
    [...new Set(posts.flatMap((post) => post.data.tags || []))].sort((a, b) =>
      a.localeCompare(b),
    ),
  );

  return {
    dir: { input: ".", output: "_site", includes: "_includes", data: "_data" },
    markdownTemplateEngine: false,
    htmlTemplateEngine: "njk",
  };
}
