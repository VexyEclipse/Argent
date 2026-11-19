// Reads the library for the Vault: every show and film the user can see, with episode
// counts, progress and (for administrators) the tags that say who else can see them.

import { getItems } from "@/api/jellyfin";
import type { BaseItem } from "@/api/types";
import { TICKS_PER_MINUTE } from "@/api/format";
import { summariseEpisodes, type EpisodeLite, type ScanTitle } from "./logic";

const PAGE = 1500;

async function all(query: Parameters<typeof getItems>[0], signal?: AbortSignal): Promise<BaseItem[]> {
  const out: BaseItem[] = [];
  for (let start = 0; ; start += PAGE) {
    const page = await getItems({ ...query, startIndex: start, limit: PAGE, enableTotalRecordCount: true }, signal);
    out.push(...page.Items);
    if (page.Items.length < PAGE || out.length >= page.TotalRecordCount) return out;
  }
}

const yearOf = (iso?: string) => {
  const y = iso ? new Date(iso).getFullYear() : NaN;
  return Number.isFinite(y) ? y : undefined;
};

export async function readLibrary(opts: { tags: boolean; ratingOf: (id: string) => number | undefined; signal?: AbortSignal }): Promise<ScanTitle[]> {
  const fields = ["ProviderIds", "Genres", "DateCreated", ...(opts.tags ? ["Tags"] : [])];
  const titlesQuery = { recursive: true, fields, enableImageTypes: ["Primary"], imageTypeLimit: 1, collapseBoxSetItems: false };
  const [shows, movies, episodes] = await Promise.all([
    all({ ...titlesQuery, includeItemTypes: ["Series"] }, opts.signal),
    all({ ...titlesQuery, includeItemTypes: ["Movie"] }, opts.signal),
    // Only what counting needs: no artwork, no extra fields.
    all({ includeItemTypes: ["Episode"], recursive: true, fields: [], enableImageTypes: [], enableImages: false, isMissing: false }, opts.signal),
  ]);
  const summaries = summariseEpisodes(episodes as EpisodeLite[]);

  const common = (i: BaseItem): ScanTitle => {
    const tag = i.ImageTags?.Primary;
    const created = Date.parse(i.DateCreated ?? "");
    return {
      id: i.Id,
      type: i.Type === "Series" ? "Series" : "Movie",
      name: i.Name,
      year: i.ProductionYear ?? yearOf(i.PremiereDate),
      ids: i.ProviderIds,
      genres: i.Genres,
      tag,
      blur: tag ? i.ImageBlurHashes?.Primary?.[tag] : undefined,
      tags: opts.tags ? (i.Tags ?? []) : undefined,
      created: Number.isFinite(created) ? created : undefined,
      rating: opts.ratingOf(i.Id) ?? (i.UserData?.Rating || undefined),
    };
  };

  return [
    ...shows.map((s) => {
      const sum = summaries.get(s.Id);
      const total = Object.values(sum?.perSeason ?? {}).reduce((a, b) => a + b, 0);
      const ended = s.Status === "Ended" ? yearOf(s.EndDate) : undefined;
      return {
        ...common(s),
        endYear: ended,
        perSeason: sum?.perSeason ?? {},
        watched: sum?.watched ?? 0,
        last: sum?.last,
        played: total > 0 && sum?.watched === total ? true : undefined,
      };
    }),
    ...movies.map((m) => ({
      ...common(m),
      minutes: m.RunTimeTicks ? Math.round(m.RunTimeTicks / TICKS_PER_MINUTE) : undefined,
      played: m.UserData?.Played ? true : undefined,
      progress: !m.UserData?.Played && m.UserData?.PlayedPercentage ? Math.round(m.UserData.PlayedPercentage) : undefined,
    })),
  ];
}
