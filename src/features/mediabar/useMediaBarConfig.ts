import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getMediaBarWebConfig } from "@/api/jellyfin";
import { loadAppConfig } from "@/config/appConfig";
import { useAuth } from "@/auth/AuthProvider";
import { clearViewerConfig, readViewerConfig, resolveConfig, saveViewerConfig, type ResolvedMediaBarConfig } from "./config";

export function useMediaBarConfig(): ResolvedMediaBarConfig & {
  ready: boolean;
  pluginDetected: boolean;
  update: (patch: Record<string, unknown>) => void;
  reset: () => void;
} {
  const { user } = useAuth();
  const userId = user?.Id ?? "anonymous";

  const plugin = useQuery({
    queryKey: ["mediabar", "webconfig"],
    queryFn: () => getMediaBarWebConfig().catch(() => null),
    staleTime: 10 * 60_000,
  });
  const app = useQuery({ queryKey: ["app-config"], queryFn: loadAppConfig, staleTime: Infinity });

  const [viewer, setViewer] = useState(() => readViewerConfig(userId));
  const [viewerFor, setViewerFor] = useState(userId);
  if (viewerFor !== userId) {
    setViewerFor(userId);
    setViewer(readViewerConfig(userId));
  }

  const resolved = useMemo(() => resolveConfig(plugin.data ?? null, app.data?.mediaBar ?? null, viewer), [plugin.data, app.data, viewer]);

  const update = useCallback(
    (patch: Record<string, unknown>) => {
      saveViewerConfig(userId, patch);
      setViewer(readViewerConfig(userId));
    },
    [userId],
  );

  const reset = useCallback(() => {
    clearViewerConfig(userId);
    setViewer({});
  }, [userId]);

  return {
    ...resolved,
    ready: !plugin.isPending && !app.isPending,
    pluginDetected: Boolean(plugin.data),
    update,
    reset,
  };
}
