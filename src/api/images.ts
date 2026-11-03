import { client } from "./jellyfin";
import type { BaseItem, ImageType } from "./types";

export interface ImageRef {
  url: string;
  blurHash?: string;
}

function hash(item: BaseItem, type: ImageType, tag?: string): string | undefined {
  if (!tag) return undefined;
  return item.ImageBlurHashes?.[type]?.[tag];
}

function ref(itemId: string, type: ImageType, tag: string, width: number, blurHash?: string, index?: number): ImageRef {
  return {
    url: client().imageUrl(itemId, type, { tag, maxWidth: width, quality: 90, index }),
    blurHash,
  };
}

/** Portrait poster. Episodes and seasons fall back to their series poster. */
export function posterImage(item: BaseItem, width = 400): ImageRef | null {
  const tag = item.ImageTags?.Primary;
  if (tag && item.Type !== "Episode") return ref(item.Id, "Primary", tag, width, hash(item, "Primary", tag));
  if (item.SeriesId && item.SeriesPrimaryImageTag) {
    return ref(item.SeriesId, "Primary", item.SeriesPrimaryImageTag, width, hash(item, "Primary", item.SeriesPrimaryImageTag));
  }
  if (tag) return ref(item.Id, "Primary", tag, width, hash(item, "Primary", tag));
  return null;
}

/** Wide backdrop, own first then the parent's (episodes, seasons). */
export function backdropImage(item: BaseItem, width = 1920, index = 0): ImageRef | null {
  const own = item.BackdropImageTags?.[index] ?? item.BackdropImageTags?.[0];
  if (own) return ref(item.Id, "Backdrop", own, width, hash(item, "Backdrop", own), item.BackdropImageTags?.indexOf(own));
  const parent = item.ParentBackdropImageTags?.[0];
  if (parent && item.ParentBackdropItemId) {
    return ref(item.ParentBackdropItemId, "Backdrop", parent, width, hash(item, "Backdrop", parent), 0);
  }
  return null;
}

export function logoImage(item: BaseItem, width = 800): ImageRef | null {
  const own = item.ImageTags?.Logo;
  if (own) return ref(item.Id, "Logo", own, width, hash(item, "Logo", own));
  if (item.ParentLogoItemId && item.ParentLogoImageTag) {
    return ref(item.ParentLogoItemId, "Logo", item.ParentLogoImageTag, width);
  }
  return null;
}

/**
 * 16:9 still for landscape cards. Episodes prefer their own frame grab; films prefer
 * a Thumb, then a backdrop.
 */
export function landscapeImage(item: BaseItem, width = 640): ImageRef | null {
  if (item.Type === "Episode" && item.ImageTags?.Primary) {
    const tag = item.ImageTags.Primary;
    return ref(item.Id, "Primary", tag, width, hash(item, "Primary", tag));
  }
  const thumb = item.ImageTags?.Thumb;
  if (thumb) return ref(item.Id, "Thumb", thumb, width, hash(item, "Thumb", thumb));
  const backdrop = backdropImage(item, width);
  if (backdrop) return backdrop;
  if (item.ParentThumbItemId && item.ParentThumbImageTag) {
    return ref(item.ParentThumbItemId, "Thumb", item.ParentThumbImageTag, width);
  }
  return posterImage(item, width);
}

export function personImage(person: { Id: string; PrimaryImageTag?: string }, width = 240): string | null {
  if (!person.PrimaryImageTag) return null;
  return client().imageUrl(person.Id, "Primary", { tag: person.PrimaryImageTag, maxWidth: width, quality: 85 });
}
