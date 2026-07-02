import { defineConfig, defineDocs } from "fumadocs-mdx/config";
import type { Parent, Root, RootContent } from "mdast";

export const docs = defineDocs({
  dir: "content/docs",
});

/**
 * The pages under content/docs are thin wrappers that <include> the repo's
 * canonical markdown (docs/*.md, README.md, AGENTS.md), so those files stay
 * the single source of truth. This plugin adapts the included content to the
 * site:
 *
 * 1. Drops the first `# h1` — the frontmatter title (rendered by DocsTitle)
 *    already carries it.
 * 2. Rewrites the repo-relative links used by those files to the docs pages
 *    that render them (or to GitHub for files with no page).
 */
const LINK_TARGETS: Record<string, string> = {
  "adding-an-agent.md": "/docs/adding-an-agent",
  "conventions.md": "/docs/conventions",
  "deployment.md": "/docs/deployment",
  "playground.md": "/docs/playground",
  "testing.md": "/docs/testing",
  "troubleshooting.md": "/docs/troubleshooting",
  "AGENTS.md": "/docs/agents",
  "README.md": "/docs",
  "SKILL.md":
    "https://github.com/TommyBez/eve-agents/blob/main/.agents/skills/eve/SKILL.md",
};

function rewriteLinks(node: Root | RootContent): void {
  if (node.type === "link" && !/^[a-z]+:/.test(node.url)) {
    const [file = "", anchor] = node.url.split("#");
    const target = LINK_TARGETS[file.split("/").at(-1) ?? ""];
    if (target) node.url = anchor ? `${target}#${anchor}` : target;
  }
  if ("children" in node) {
    for (const child of node.children) rewriteLinks(child);
  }
}

function dropLeadingH1(parent: Root | Extract<RootContent, Parent>): boolean {
  for (const [index, child] of parent.children.entries()) {
    if (child.type === "heading") {
      if (child.depth === 1) {
        parent.children.splice(index, 1);
        return true;
      }
      return false;
    }
    if ("children" in child && dropLeadingH1(child)) return true;
  }
  return false;
}

function remarkRepoContent() {
  return (tree: Root) => {
    dropLeadingH1(tree);
    rewriteLinks(tree);
  };
}

export default defineConfig({
  mdxOptions: {
    remarkPlugins: (defaults) => [...defaults, remarkRepoContent],
  },
});
