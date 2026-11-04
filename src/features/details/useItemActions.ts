import { useMutation, useQueryClient } from "@tanstack/react-query";
import { setFavorite, setPlayed } from "@/api/jellyfin";
import type { BaseItem, UserItemData } from "@/api/types";

/** Optimistic favourite / watched toggles that keep every cached copy in sync. */
export function useItemActions(item: BaseItem | undefined) {
  const qc = useQueryClient();

  const patch = (data: Partial<UserItemData>) => {
    if (!item) return;
    qc.setQueryData<BaseItem>(["item", item.Id], (old) => (old ? { ...old, UserData: { ...old.UserData, ...data } } : old));
  };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["home"] });
    qc.invalidateQueries({ queryKey: ["rec", "history"] });
    qc.invalidateQueries({ queryKey: ["browse"] });
    qc.invalidateQueries({ queryKey: ["episodes"] });
    qc.invalidateQueries({ queryKey: ["seasons"] });
    qc.invalidateQueries({ queryKey: ["nextup"] });
  };

  const favourite = useMutation({
    mutationFn: (value: boolean) => setFavorite(item!.Id, value),
    onMutate: (value) => patch({ IsFavorite: value }),
    onError: (_e, value) => patch({ IsFavorite: !value }),
    onSettled: invalidate,
  });

  const played = useMutation({
    mutationFn: (value: boolean) => setPlayed(item!.Id, value),
    onMutate: (value) => patch({ Played: value, PlaybackPositionTicks: value ? 0 : item?.UserData?.PlaybackPositionTicks }),
    onError: (_e, value) => patch({ Played: !value }),
    onSettled: () => {
      if (item) qc.invalidateQueries({ queryKey: ["item", item.Id] });
      invalidate();
    },
  });

  return {
    isFavorite: Boolean(item?.UserData?.IsFavorite),
    isPlayed: Boolean(item?.UserData?.Played),
    toggleFavorite: () => item && favourite.mutate(!item.UserData?.IsFavorite),
    togglePlayed: () => item && played.mutate(!item.UserData?.Played),
  };
}

/** Marks several items at once (a few requests in flight at a time). */
async function setPlayedMany(ids: string[], value: boolean) {
  const queue = [...ids];
  const worker = async () => {
    for (let id = queue.shift(); id; id = queue.shift()) await setPlayed(id, value);
  };
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
}

/**
 * Watched state for many items: a whole season (Jellyfin marks its episodes), or a
 * list of episodes ("everything before this one").
 */
export function useBulkPlayed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, value }: { ids: string[]; value: boolean }) => setPlayedMany(ids, value),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["item"] });
      qc.invalidateQueries({ queryKey: ["episodes"] });
      qc.invalidateQueries({ queryKey: ["seasons"] });
      qc.invalidateQueries({ queryKey: ["nextup"] });
      qc.invalidateQueries({ queryKey: ["home"] });
      qc.invalidateQueries({ queryKey: ["browse"] });
      qc.invalidateQueries({ queryKey: ["rec", "history"] });
    },
  });
}

/** Lightweight toggle for list rows (episodes) without a dedicated item cache. */
export function useTogglePlayed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, value }: { id: string; value: boolean }) => setPlayed(id, value),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["episodes"] });
      qc.invalidateQueries({ queryKey: ["seasons"] });
      qc.invalidateQueries({ queryKey: ["nextup"] });
      qc.invalidateQueries({ queryKey: ["home"] });
      qc.invalidateQueries({ queryKey: ["rec", "history"] });
    },
  });
}
