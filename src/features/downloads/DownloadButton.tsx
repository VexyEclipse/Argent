import { useNavigate } from "react-router";
import type { BaseItem } from "@/api/types";
import { Button } from "@/components/Button";
import { percentOf } from "./logic";
import { downloadsSupported, useDownload } from "./store";
import { useDownloadDialog } from "./DownloadDialog";

/** Download one film or episode; once it's downloading or saved, opens Downloads. */
export function DownloadButton({ item, size = "lg" }: { item: BaseItem; size?: "sm" | "lg" }) {
  const navigate = useNavigate();
  const record = useDownload(item.Id);
  const dialog = useDownloadDialog();
  if (!downloadsSupported() || (item.Type !== "Movie" && item.Type !== "Episode" && item.Type !== "Video") || item.LocationType === "Virtual") return null;

  const label = !record
    ? "Download"
    : record.state === "done"
      ? "Downloaded: open Downloads"
      : record.state === "failed"
        ? "Download failed: open Downloads"
        : `Downloading ${percentOf(record)}%: open Downloads`;
  return (
    <>
      <Button
        variant="icon"
        size={size}
        icon={record?.state === "done" ? "check" : "download"}
        active={Boolean(record)}
        className={record && record.state !== "done" ? "dl-button--busy" : undefined}
        style={record && record.state !== "done" ? { ["--dl" as string]: `${percentOf(record)}%` } : undefined}
        onClick={() => (record ? navigate("/downloads") : dialog.open([item], item.Type === "Episode" ? `${item.SeriesName ?? ""} · ${item.Name}` : item.Name))}
        aria-label={label}
        title={label}
      />
      {dialog.dialog}
    </>
  );
}
