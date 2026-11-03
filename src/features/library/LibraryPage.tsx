import { useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { getViews } from "@/api/jellyfin";
import { Spinner } from "@/components/States";
import { BrowseView } from "./BrowseView";

/** Any other library (home videos, mixed content, music videos…), browsed generically. */
export default function LibraryPage() {
  const { id = "" } = useParams();
  const views = useQuery({ queryKey: ["views"], queryFn: getViews, staleTime: 5 * 60_000 });
  const view = views.data?.Items.find((v) => v.Id === id);
  if (views.isPending) return <Spinner />;

  const types: Record<string, string[]> = {
    homevideos: ["Video", "Photo"],
    musicvideos: ["MusicVideo"],
    music: ["MusicAlbum"],
    books: ["Book"],
    mixed: ["Movie", "Series", "Video"],
  };
  const includeItemTypes = types[view?.CollectionType ?? ""] ?? undefined;

  return (
    <BrowseView
      key={id}
      title={view?.Name ?? "Library"}
      base={{ parentId: id, includeItemTypes, recursive: Boolean(includeItemTypes) }}
      sorts={["name", "added", "released", "random"]}
      queryKey={["library", id]}
    />
  );
}
