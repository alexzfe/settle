import { Link, useParams } from "react-router";
import styles from "./App.module.css";
import { blueprintPageUrl } from "./api";
import { pageCount, pagePath } from "./Blueprints";
import { levelTitle } from "./format";
import { useBlueprints } from "./queries";
import { Fact } from "./Values";

/** One page of a Blueprint, rendered at its natural size, with links to the pages either side. */
export function BlueprintPage() {
  const { home = "", blueprint: slug = "", page: number = "" } = useParams();
  const blueprints = useBlueprints(home);
  if (blueprints.isPending) return <p>Loading…</p>;
  if (blueprints.isError) return <p className={styles.error}>{blueprints.error.message}</p>;
  const blueprint = blueprints.data.blueprints.find((each) => each.slug === slug);
  if (!blueprint) return <p className={styles.error}>This Home has no Blueprint "{slug}".</p>;
  const page = blueprint.pages.find((each) => String(each.page) === number);
  if (!page) {
    return (
      <p className={styles.error}>
        {blueprint.label} has no page {number}: it has {pageCount(blueprint.pageCount)}.
      </p>
    );
  }
  const previous = blueprint.pages.find((each) => each.page === page.page - 1);
  const next = blueprint.pages.find((each) => each.page === page.page + 1);
  return (
    <>
      <h1>
        {blueprint.label}, page {page.page} of {blueprint.pageCount}
      </h1>
      <dl className={styles.facts}>
        <Fact term="Level">{page.level && levelTitle(page.level)}</Fact>
        <Fact term="Size">
          {page.width} × {page.height} px
        </Fact>
        <Fact term="Text layer">{page.hasText ? "Yes" : "None, so it is read from the image"}</Fact>
      </dl>
      <nav className={styles.nav} aria-label="Pages">
        {previous && (
          <Link to={pagePath(home, blueprint.slug, previous.page)}>
            Previous page ({previous.page})
          </Link>
        )}
        {next && (
          <Link to={pagePath(home, blueprint.slug, next.page)}>Next page ({next.page})</Link>
        )}
      </nav>
      <div className={styles.viewer}>
        <img
          src={blueprintPageUrl(home, blueprint.slug, page.page)}
          width={page.width}
          height={page.height}
          alt={`Page ${page.page} of ${blueprint.label}`}
        />
      </div>
    </>
  );
}
