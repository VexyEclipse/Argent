import { useMemo } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { getGenres, getItems } from "@/api/jellyfin";
import { backdropImage } from "@/api/images";
import type { BaseItem } from "@/api/types";
import { Artwork } from "@/components/Artwork";
import { Row } from "@/components/Row";

function GenreTile({ genre }: { genre: BaseItem }) {
  // One representative backdrop per genre, picked at random and cached.
  const sample = useQuery({
    queryKey: ["genre-sample", genre.Id],
    queryFn: () =>
      getItems({
        genres: genre.Name,
        includeItemTypes: ["Movie", "Series"],
        recursive: true,
        imageTypes: ["Backdrop"],
        sortBy: ["Random"],
        limit: 1,
        enableUserData: false,
      }).then((r) => r.Items[0] ?? null),
    staleTime: 60 * 60_000,
  });
  const image = sample.data ? backdropImage(sample.data, 640) : null;
  return (
    <div className="card card--landscape genre-tile">
      <Link to={`/genre/${genre.Id}`} className="card__link">
        <div className="card__media">
          <Artwork image={image} alt="" />
          <div className="genre-tile__shade" />
          <span className="genre-tile__name">{genre.Name}</span>
        </div>
      </Link>
    </div>
  );
}

export function GenreRow({ preferred, counts }: { preferred: string[]; counts?: Map<string, number> }) {
  const genres = useQuery({
    queryKey: ["genres", "home"],
    queryFn: () => getGenres({ includeItemTypes: ["Movie", "Series"] }).then((r) => r.Items),
    staleTime: 30 * 60_000,
  });

  // Real genres only: drop tiny ones and lowercase tag imports (e.g. AniDB's "afterlife").
  // The user's own leading genres come first, then the library's biggest.
  const ordered = useMemo(() => {
    const count = (name: string) => counts?.get(name) ?? 0;
    const list = (genres.data ?? []).filter((g) => /^\p{Lu}/u.test(g.Name) && (!counts || count(g.Name) >= 3));
    const rank = new Map(preferred.map((g, i) => [g, i]));
    return [...list]
      .sort((a, b) => (rank.get(a.Name) ?? 999) - (rank.get(b.Name) ?? 999) || count(b.Name) - count(a.Name) || a.Name.localeCompare(b.Name))
      .slice(0, 16);
  }, [genres.data, preferred, counts]);

  if (!genres.isPending && !ordered.length) return null;
  return (
    <Row title="Genres" variant="landscape" loading={genres.isPending} className="row--genres">
      {ordered.map((g) => (
        <GenreTile key={g.Id} genre={g} />
      ))}
    </Row>
  );
}
