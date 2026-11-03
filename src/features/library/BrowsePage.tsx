import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { getViews } from "@/api/jellyfin";
import { BrowseView } from "./BrowseView";

const COLLECTION_TYPE = { Movie: "movies", Series: "tvshows" } as const;

export default function BrowsePage({ kind }: { kind: "Movie" | "Series" }) {
  const [params, setParams] = useSearchParams();
  const views = useQuery({ queryKey: ["views"], queryFn: getViews, staleTime: 5 * 60_000 });
  const libraries = (views.data?.Items ?? []).filter((v) => v.CollectionType === COLLECTION_TYPE[kind]);
  const libraryId = params.get("lib");
  const active = libraries.find((l) => l.Id === libraryId);

  const header =
    libraries.length > 1 ? (
      <div className="tabs" role="tablist" aria-label="Library">
        <button role="tab" aria-selected={!active} className={!active ? "is-active" : ""} onClick={() => setParams({}, { replace: true })}>
          All
        </button>
        {libraries.map((l) => (
          <button
            key={l.Id}
            role="tab"
            aria-selected={active?.Id === l.Id}
            className={active?.Id === l.Id ? "is-active" : ""}
            onClick={() => setParams({ lib: l.Id }, { replace: true })}
          >
            {l.Name}
          </button>
        ))}
      </div>
    ) : null;

  const sorts =
    kind === "Movie"
      ? ["name", "added", "released", "rating", "critics", "runtime", "played", "random"]
      : ["name", "added", "updated", "released", "rating", "played", "random"];

  return (
    <BrowseView
      key={kind}
      title={kind === "Movie" ? "Movies" : "Series"}
      base={{ includeItemTypes: [kind], parentId: active?.Id }}
      sorts={sorts}
      header={header}
      queryKey={[kind, active?.Id ?? "all"]}
    />
  );
}
