import { useParams, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { client } from "@/api/jellyfin";
import type { BaseItem } from "@/api/types";
import { Spinner } from "@/components/States";
import { BrowseView } from "./BrowseView";

export default function GenrePage() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const genre = useQuery({
    queryKey: ["genre", id],
    queryFn: () => client().request<BaseItem>(`/Items/${id}`, { query: { userId: client().userId } }),
    staleTime: 30 * 60_000,
  });
  const type = params.get("type") === "Series" ? "Series" : params.get("type") === "Movie" ? "Movie" : null;
  if (genre.isPending) return <Spinner />;

  const header = (
    <div className="tabs" role="tablist" aria-label="Type">
      {[
        [null, "All"],
        ["Movie", "Movies"],
        ["Series", "Series"],
      ].map(([v, label]) => (
        <button
          key={label}
          role="tab"
          aria-selected={type === v}
          className={type === v ? "is-active" : ""}
          onClick={() => setParams(v ? { type: v } : {}, { replace: true })}
        >
          {label}
        </button>
      ))}
    </div>
  );

  return (
    <BrowseView
      key={`${id}:${type}`}
      title={genre.data?.Name ?? "Genre"}
      base={{ genreIds: [id], includeItemTypes: type ? [type] : ["Movie", "Series"] }}
      sorts={["rating", "name", "added", "released", "random"]}
      defaultSort="rating"
      header={header}
      showGenreFilter={false}
      queryKey={["genre", id, type]}
    />
  );
}
