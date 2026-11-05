import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router";
import { useAuth } from "@/auth/AuthProvider";
import { LoginPage } from "@/auth/LoginPage";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { FullScreenLoader } from "@/components/States";
import { Shell, useTvNavigation } from "@/layouts/Shell";
import { HomePage } from "@/features/home/HomePage";
import { TogetherRoot } from "@/features/together/TogetherRoot";
import { useDownloadsRunner } from "@/features/downloads/store";

// Everything past the home page loads on demand.
const BrowsePage = lazy(() => import("@/features/library/BrowsePage"));
const CollectionsPage = lazy(() => import("@/features/library/CollectionsPage"));
const LibraryPage = lazy(() => import("@/features/library/LibraryPage"));
const GenrePage = lazy(() => import("@/features/library/GenrePage"));
const DetailsPage = lazy(() => import("@/features/details/DetailsPage"));
const PersonPage = lazy(() => import("@/features/details/PersonPage"));
const SearchPage = lazy(() => import("@/features/search/SearchPage"));
const PlayerPage = lazy(() => import("@/features/player/PlayerPage"));
const ProfilePage = lazy(() => import("@/features/profile/ProfilePage"));
const WatchlistPage = lazy(() => import("@/features/watchlist/WatchlistPage"));
const TogetherPage = lazy(() => import("@/features/together/TogetherPage"));
const DownloadsPage = lazy(() => import("@/features/downloads/DownloadsPage"));
const OfflineShell = lazy(() => import("@/features/downloads/OfflineShell").then((m) => ({ default: m.OfflineShell })));

export function App() {
  const { status } = useAuth();
  const location = useLocation();
  useTvNavigation();
  useDownloadsRunner();
  if (status === "loading") return <FullScreenLoader />;
  if (status === "signedOut") return <LoginPage />;

  // The server can't be reached: your downloads, and nothing that needs the server.
  if (status === "offline")
    return (
      <Suspense fallback={<FullScreenLoader />}>
        <Routes>
          <Route
            path="/play/:id"
            element={
              <ErrorBoundary resetKey={location.pathname} fullScreen>
                <PlayerPage />
              </ErrorBoundary>
            }
          />
          <Route element={<OfflineShell />}>
            <Route path="downloads" element={<DownloadsPage />} />
            <Route path="*" element={<Navigate to="/downloads" replace />} />
          </Route>
        </Routes>
      </Suspense>
    );

  return (
    <Suspense fallback={<FullScreenLoader />}>
      <TogetherRoot />
      <Routes>
        <Route
          path="/play/:id"
          element={
            <ErrorBoundary resetKey={location.pathname} fullScreen>
              <PlayerPage />
            </ErrorBoundary>
          }
        />
        <Route element={<Shell />}>
          <Route index element={<HomePage />} />
          <Route path="movies" element={<BrowsePage kind="Movie" />} />
          <Route path="series" element={<BrowsePage kind="Series" />} />
          <Route path="anime" element={<BrowsePage kind="Anime" />} />
          <Route path="collections" element={<CollectionsPage />} />
          <Route path="watchlist" element={<WatchlistPage />} />
          <Route path="library/:id" element={<LibraryPage />} />
          <Route path="genre/:id" element={<GenrePage />} />
          <Route path="details/:id" element={<DetailsPage />} />
          <Route path="person/:id" element={<PersonPage />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="together" element={<TogetherPage />} />
          <Route path="downloads" element={<DownloadsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
