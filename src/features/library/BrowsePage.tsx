import { useSearchParams } from "react-router";
import { useLibraryGroups } from "@/api/libraries";
import { Spinner } from "@/components/States";
import { BrowseView } from "./BrowseView";

export type BrowseKind = "Movie" | "Series" | "Anime";

const TITLES: Record<BrowseKind, string> = { Movie: "Movies", Series: "Series", Anime: "Anime" };

export default function BrowsePage({ kind }: { kind: BrowseKind }) {
  const [params, setParams] = useSearchParams();
  const groups = useLibraryGroups();
  if (groups.isPending) return <Spinner />;

  const libraries = kind === "Movie" ? groups.movies : kind === "Series" ? groups.series : groups.anime;
  const requested = libraries.find((l) => l.Id === params.get("lib"));
  // Movies can show every library at once. Series and Anime can't: the API has no
  // way to say "all TV libraries except the anime ones", so they default to a library.
  const allowAll = kind === "Movie" || libraries.length === 0;
  const active = requested ?? (allowAll ? undefined : libraries[0]);

  const tabs = allowAll ? [undefined, ...libraries] : libraries;
  const header =
    tabs.length > 1 ? (
      <div className="tabs" role="tablist" aria-label="Library">
        {tabs.map((l) => (
          <button
            key={l?.Id ?? "all"}
            role="tab"
            aria-selected={active?.Id === l?.Id}
            className={active?.Id === l?.Id ? "is-active" : ""}
            onClick={() => setParams(l ? { lib: l.Id } : {}, { replace: true })}
          >
            {l?.Name ?? "All"}
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
      title={TITLES[kind]}
      base={{ includeItemTypes: kind === "Anime" ? ["Series", "Movie"] : [kind], parentId: active?.Id }}
      sorts={sorts}
      header={header}
      queryKey={[kind, active?.Id ?? "all"]}
    />
  );
}
