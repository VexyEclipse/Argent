import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { getLocalTrailers, getSimilar, getSpecialFeatures } from "@/api/jellyfin";
import { formatRuntime, joinDots } from "@/api/format";
import { personImage } from "@/api/images";
import type { BaseItem, BaseItemPerson, MediaStream } from "@/api/types";
import { MediaCard } from "@/components/MediaCard";
import { Row } from "@/components/Row";

export function CastRow({ people, title = "Cast & Crew" }: { people?: BaseItemPerson[]; title?: string }) {
  if (!people?.length) return null;
  // Directors and writers lead, then cast in billing order.
  const crew = people.filter((p) => p.Type === "Director" || p.Type === "Writer");
  const cast = people.filter((p) => p.Type === "Actor" || p.Type === "GuestStar");
  const ordered = [...crew, ...cast].slice(0, 40);
  return (
    <Row title={title} className="row--people">
      {ordered.map((p, i) => {
        const img = personImage(p, 240);
        return (
          <div className="person" key={`${p.Id}-${p.Type}-${i}`}>
            <Link to={`/person/${p.Id}`} className="person__link">
              <div className="person__photo">
                {img ? (
                  <img src={img} alt="" loading="lazy" />
                ) : (
                  <span>
                    {p.Name.split(" ")
                      .map((s) => s[0])
                      .slice(0, 2)
                      .join("")}
                  </span>
                )}
              </div>
              <span className="person__name">{p.Name}</span>
              <span className="person__role">{p.Type === "Actor" || p.Type === "GuestStar" ? p.Role || "Actor" : p.Type}</span>
            </Link>
          </div>
        );
      })}
    </Row>
  );
}

export function SimilarRow({ item }: { item: BaseItem }) {
  const similar = useQuery({ queryKey: ["similar", item.Id], queryFn: () => getSimilar(item.Id, 18).then((r) => r.Items), staleTime: 30 * 60_000 });
  if (!similar.isPending && !similar.data?.length) return null;
  return (
    <Row title="More Like This" loading={similar.isPending}>
      {similar.data?.map((i) => (
        <MediaCard key={i.Id} item={i} />
      ))}
    </Row>
  );
}

const EXTRA_LABELS: Record<string, string> = {
  Trailer: "Trailer",
  BehindTheScenes: "Behind the scenes",
  DeletedScene: "Deleted scene",
  Featurette: "Featurette",
  Interview: "Interview",
  Scene: "Scene",
  Sample: "Sample",
  Clip: "Clip",
  ThemeVideo: "Theme video",
  Short: "Short",
  Unknown: "Extra",
};

/** Local trailers and special features (behind the scenes, deleted scenes…). */
export function ExtrasRow({ item }: { item: BaseItem }) {
  const hasTrailers = (item.LocalTrailerCount ?? 0) > 0;
  const extras = useQuery({
    queryKey: ["extras", item.Id],
    queryFn: async () => {
      const [trailers, features] = await Promise.all([
        hasTrailers ? getLocalTrailers(item.Id).catch(() => []) : Promise.resolve([]),
        getSpecialFeatures(item.Id).catch(() => []),
      ]);
      return [...trailers.map((t) => ({ ...t, ExtraType: t.ExtraType ?? "Trailer" })), ...features];
    },
    staleTime: 30 * 60_000,
  });
  if (!extras.data?.length) return null;
  return (
    <Row title="Extras" variant="landscape">
      {extras.data.map((x) => (
        <MediaCard
          key={x.Id}
          item={x}
          variant="landscape"
          playOnClick
          subtitle={joinDots([EXTRA_LABELS[x.ExtraType ?? ""] ?? "Extra", formatRuntime(x.RunTimeTicks)])}
        />
      ))}
    </Row>
  );
}

function streamLabel(s: MediaStream): string {
  return s.DisplayTitle || [s.Language, s.Codec?.toUpperCase()].filter(Boolean).join(" · ") || `Track ${s.Index}`;
}

export function InfoTable({ item }: { item: BaseItem }) {
  const directors = item.People?.filter((p) => p.Type === "Director") ?? [];
  const writers = item.People?.filter((p) => p.Type === "Writer") ?? [];
  const source = item.MediaSources?.[0];
  const streams = source?.MediaStreams ?? item.MediaStreams ?? [];
  const video = streams.find((s) => s.Type === "Video");
  const audio = streams.filter((s) => s.Type === "Audio");
  const subs = streams.filter((s) => s.Type === "Subtitle");

  const rows: [string, React.ReactNode][] = [];
  if (directors.length)
    rows.push([directors.length > 1 ? "Directors" : "Director", directors.map((d, i) => <PersonLink key={d.Id} p={d} last={i === directors.length - 1} />)]);
  if (writers.length)
    rows.push([writers.length > 1 ? "Writers" : "Writer", writers.map((d, i) => <PersonLink key={d.Id} p={d} last={i === writers.length - 1} />)]);
  if (item.Studios?.length) rows.push(["Studio", item.Studios.map((s) => s.Name).join(", ")]);
  if (item.PremiereDate) rows.push(["Released", new Date(item.PremiereDate).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })]);
  if (video) rows.push(["Video", video.DisplayTitle || `${video.Width}×${video.Height} ${video.Codec?.toUpperCase() ?? ""}`]);
  if (audio.length) rows.push(["Audio", audio.slice(0, 4).map(streamLabel).join(", ") + (audio.length > 4 ? ` +${audio.length - 4}` : "")]);
  if (subs.length)
    rows.push([
      "Subtitles",
      subs
        .slice(0, 6)
        .map((s) => s.Language || s.DisplayTitle || "Unknown")
        .join(", ") + (subs.length > 6 ? ` +${subs.length - 6}` : ""),
    ]);
  if (item.ExternalUrls?.length)
    rows.push([
      "Links",
      item.ExternalUrls.map((u, i) => (
        <span key={u.Url}>
          <a href={u.Url} target="_blank" rel="noreferrer" className="link">
            {u.Name}
          </a>
          {i < item.ExternalUrls!.length - 1 ? ", " : ""}
        </span>
      )),
    ]);
  if (!rows.length) return null;

  return (
    <section className="info">
      <h2 className="row__title">Details</h2>
      <dl className="info__table">
        {rows.map(([k, v]) => (
          <div className="info__row" key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function PersonLink({ p, last }: { p: BaseItemPerson; last: boolean }) {
  return (
    <>
      <Link to={`/person/${p.Id}`} className="link">
        {p.Name}
      </Link>
      {last ? "" : ", "}
    </>
  );
}
