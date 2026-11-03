import { useState } from "react";
import { useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { CARD_FIELDS, getItemFull, getItems } from "@/api/jellyfin";
import { personImage } from "@/api/images";
import { MediaCard } from "@/components/MediaCard";
import { EmptyState, Spinner } from "@/components/States";
import "./details.css";

export default function PersonPage() {
  const { id = "" } = useParams();
  const [expanded, setExpanded] = useState(false);
  const person = useQuery({ queryKey: ["item", id], queryFn: () => getItemFull(id), staleTime: 30 * 60_000 });
  const works = useQuery({
    queryKey: ["person-works", id],
    queryFn: () =>
      getItems({
        personIds: [id],
        includeItemTypes: ["Movie", "Series"],
        recursive: true,
        sortBy: ["PremiereDate", "ProductionYear", "SortName"],
        sortOrder: "Descending",
        fields: CARD_FIELDS,
      }).then((r) => r.Items),
    staleTime: 10 * 60_000,
  });

  if (person.isPending) return <Spinner />;
  const p = person.data;
  if (!p) return <EmptyState title="Person not found" />;
  const img = personImage({ Id: p.Id, PrimaryImageTag: p.ImageTags?.Primary }, 480);
  const born = p.PremiereDate ? new Date(p.PremiereDate) : null;
  const movies = works.data?.filter((w) => w.Type === "Movie") ?? [];
  const series = works.data?.filter((w) => w.Type === "Series") ?? [];

  return (
    <div className="page person-page">
      <header className="person-page__header">
        <div className="person-page__photo">{img ? <img src={img} alt="" /> : <span>{p.Name.slice(0, 1)}</span>}</div>
        <div className="person-page__text">
          <span className="eyebrow">In your library</span>
          <h1 className="page-title">{p.Name}</h1>
          {born && (
            <p className="muted">
              Born {born.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
              {p.ProductionLocations?.[0] ? ` · ${p.ProductionLocations[0]}` : ""}
            </p>
          )}
          {p.Overview && (
            <p className={`person-page__bio ${expanded ? "is-expanded" : ""}`} onClick={() => setExpanded((e) => !e)}>
              {p.Overview}
            </p>
          )}
        </div>
      </header>

      {works.isPending ? (
        <Spinner />
      ) : !works.data?.length ? (
        <EmptyState title="Nothing in your library yet" />
      ) : (
        <>
          {movies.length > 0 && (
            <section className="person-page__section">
              <h2 className="row__title">Movies · {movies.length}</h2>
              <div className="grid">
                {movies.map((m) => (
                  <MediaCard key={m.Id} item={m} />
                ))}
              </div>
            </section>
          )}
          {series.length > 0 && (
            <section className="person-page__section">
              <h2 className="row__title">Series · {series.length}</h2>
              <div className="grid">
                {series.map((m) => (
                  <MediaCard key={m.Id} item={m} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
