# Recommendation engine

`src/features/recommendations/engine` is pure TypeScript with no React and no network access. `data.ts` collects its inputs from Jellyfin and `useRecommendations.ts` connects it to the UI. Every user gets their own profile, built only from their own history, and only titles they can access are ever scored.

## Inputs (per user)

| Signal                                                                      | Source                                                           |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Watched films, with play count and last-played date                         | `/Items?isPlayed=true&includeItemTypes=Movie`                    |
| Partly watched films (progress, abandoned or not)                           | `/Items?filters=IsResumable`                                     |
| Watched episodes, aggregated per series (episodes seen, rewatches, recency) | `/Items?isPlayed=true&includeItemTypes=Episode`                  |
| Favourites, likes and user ratings                                          | `UserData`                                                       |
| Genres, tags, studios, people, year, ratings, runtime, date added           | item metadata (`People` only for history items)                  |
| Jellyfin's own similarity                                                   | `/Items/{seed}/Similar` for the strongest seeds                  |
| Other work by favoured actors, directors and writers                        | `/Items?personIds=` for the top people                           |
| Dismissals ("Not interested") and impressions                               | local, with dismissals mirrored to the user's DisplayPreferences |

Nothing is invented. Missing metadata contributes nothing; it is never guessed.

## Profile

Each history title gets an **engagement weight** (`engagementWeight`) built from:

- completion (finished = 1; partial scales; a series ramps up with episodes watched)
- recency (half-life of about four months, floored so old favourites still count)
- rewatching (×1.25 per extra play, capped)
- favourite ×1.6, liked ×1.4, user rating 0.6–1.4
- **negative** weight for disliked titles and titles abandoned early and long ago

Feature affinities (genres, genre pairs, tags, studios, people, decades) are the weighted share of history. They are then adjusted:

- **Lift over the library baseline.** A genre that makes up half your library (Drama) says little; a rare one you keep choosing says a lot.
- **Support.** `1 − e^(−titles/2.2)`. One film with an actor is weak evidence; four films is a pattern. This stops the engine from assuming that liking one title means liking everything similar to it.

## Scoring

Each eligible candidate gets components in the range 0–1, combined with `DEFAULT_WEIGHTS`:

| Component | Weight | Meaning                                                                                                                     |
| --------- | ------ | --------------------------------------------------------------------------------------------------------------------------- |
| genre     | 0.24   | best genre affinity, mean across its genres, plus a bonus for favoured genre pairs (Jellyfin's closest thing to sub-genres) |
| similar   | 0.20   | Jellyfin similarity to your strongest seeds; matching several seeds compounds                                               |
| people    | 0.17   | top matched actors, directors and writers (diminishing: 1, ½, ¼)                                                            |
| quality   | 0.11   | community and critic score, steeper for users who watch well-rated titles                                                   |
| tags      | 0.07   | tag affinity                                                                                                                |
| era       | 0.07   | decade affinity relative to the library, smoothed into neighbouring decades                                                 |
| type      | 0.05   | your film/series balance                                                                                                    |
| studio    | 0.04   | studio affinity                                                                                                             |
| runtime   | 0.03   | closeness to your typical film length                                                                                       |
| freshness | 0.02   | recently added                                                                                                              |

The score is then adjusted:

- **Penalties.** Genres from dismissed or abandoned titles, and titles shown repeatedly without being opened (decays over a week).
- **Daily rotation.** A small, deterministic per-day jitter, so near-ties swap places day to day without the list becoming random.

**Eligibility.** Watched titles, titles in progress (those belong in Continue Watching), series you have started (those belong in Next Up) and dismissed titles are never recommended.

**Strength.** Strong means top 10% _and_ backed by a specific signal (similarity, a person or a strong genre match). Good means top 35%. Everything else is exploratory. Each pick carries its strongest reason ("Because you watched Arrival", "Directed by Denis Villeneuve", "Matches your taste in Thriller").

**Diversity.** The final row uses maximal marginal relevance (λ = 0.22), so it isn't ten near-identical titles.

## Outputs

- **Recommended For You**: the diversified top 20.
- **Personalised sections**: "Because you watched X" (the two strongest seeds with at least five similar unwatched titles), a recurring director, writer or actor, your favourite genre pairing, and a favoured decade. The three that overlap least with the main row are shown.
- **Discover**: the long tail. Well-rated titles that have sat unwatched for a while, chosen by a daily seeded shuffle and excluding what is already shown above.
- **Cold start**: with no history, ranking falls back to quality, freshness and a daily seed, and everything is labelled exploratory.

## Updating

History is refetched when its two-minute cache expires, and immediately after playback stops. The server signals are keyed on a history signature, so they recompute only when viewing actually changes. Dismissing a title re-scores instantly.

## Tests

`npm test` runs `engine.test.ts`, which covers:

- engagement ordering
- negative signals
- support thresholds
- library-baseline discounting
- preference matching
- eligibility exclusions
- similarity and people signals with reasons
- impression fatigue
- user separation
- cold start
