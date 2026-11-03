import { BrowseView } from "./BrowseView";

export default function CollectionsPage() {
  return (
    <BrowseView
      title="Collections"
      base={{ includeItemTypes: ["BoxSet"] }}
      sorts={["name", "added", "updated", "random"]}
      showWatchedFilter={false}
      showYearFilter={false}
      showGenreFilter={false}
      queryKey={["collections"]}
    />
  );
}
