package com.vexyeclipse.argent;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Display;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.window.OnBackInvokedDispatcher;

import androidx.annotation.OptIn;
import androidx.media3.common.C;
import androidx.media3.common.Format;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.common.TrackSelectionParameters;
import androidx.media3.common.Tracks;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.ui.PlayerView;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.lang.ref.WeakReference;
import java.util.ArrayList;
import java.util.List;

/**
 * The native player (Media3 / ExoPlayer). The web app chooses the stream and opens this
 * with an ExternalRequest (src/features/player/externalPlan.ts); this plays it with the
 * device's own decoders, so HDR and Dolby Vision reach the TV, Dolby and DTS audio pass
 * through to a receiver, and every subtitle format inside the file is shown. It reports
 * position and track changes back to the page, which keeps the server informed, and
 * returns a result (ended, stopped, next…) when it closes.
 */
@OptIn(markerClass = UnstableApi.class)
public class PlayerActivity extends Activity {
    static final String EXTRA_REQUEST = "request";
    private static final int STATE_EVERY_MS = 3000;
    private static final int TICK_MS = 500;

    private static WeakReference<PlayerActivity> current = new WeakReference<>(null);

    private ExoPlayer player;
    private PlayerView view;
    private TextView title;
    private Button skipButton;
    private Button nextButton;
    private JSONObject request;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final List<double[]> segments = new ArrayList<>();
    private final List<String> segmentTypes = new ArrayList<>();
    private double upNextAt = -1;
    private boolean tracksApplied;
    private boolean finished;
    private boolean interacted;
    private long startedAt;
    private long lastStateAt;
    private boolean lastPaused;

    /** The open player, for remote control from the page. */
    static PlayerActivity current() {
        return current.get();
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        try {
            request = new JSONObject(getIntent().getStringExtra(EXTRA_REQUEST));
        } catch (JSONException | NullPointerException e) {
            finishWith("error", "Invalid playback request");
            return;
        }
        current = new WeakReference<>(this);
        startedAt = System.currentTimeMillis();
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::back);
        }
        buildViews();
        // After setContentView: the window's insets controller needs its view.
        hideSystemBars();
        readSegments();
        startPlayer();
        handler.post(tick);
    }

    // ---- views ------------------------------------------------------------------------

    private int dp(float v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }

    private Button pill(String label) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextColor(0xFF0B0B0C);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        b.setTypeface(Typeface.DEFAULT_BOLD);
        b.setPadding(dp(22), dp(10), dp(22), dp(10));
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(0xFFE6E8EB);
        bg.setCornerRadius(dp(24));
        b.setBackground(bg);
        b.setFocusable(true);
        b.setVisibility(View.GONE);
        b.setOnFocusChangeListener((v, has) -> v.setScaleX(has ? 1.06f : 1f));
        return b;
    }

    private void buildViews() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);

        view = new PlayerView(this);
        view.setKeepScreenOn(true);
        view.setShowSubtitleButton(true);
        view.setShowNextButton(false);
        view.setShowPreviousButton(false);
        view.setControllerShowTimeoutMs(4000);
        // Subtitles follow the viewer's system caption style (Settings → Accessibility).
        if (view.getSubtitleView() != null) {
            view.getSubtitleView().setUserDefaultStyle();
            view.getSubtitleView().setUserDefaultTextSize();
        }
        root.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        title = new TextView(this);
        title.setTextColor(0xFFF5F6F7);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        title.setShadowLayer(8, 0, 2, 0xCC000000);
        title.setPadding(dp(32), dp(24), dp(32), dp(24));
        String sub = request.optString("subtitle", "");
        title.setText(sub.isEmpty() ? request.optString("title") : request.optString("title") + "\n" + sub);
        root.addView(title, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP));
        view.setControllerVisibilityListener((PlayerView.ControllerVisibilityListener) visibility -> title.setVisibility(visibility));

        LinearLayout actions = new LinearLayout(this);
        actions.setOrientation(LinearLayout.HORIZONTAL);
        actions.setPadding(dp(32), dp(32), dp(32), dp(128));
        skipButton = pill("Skip intro");
        skipButton.setOnClickListener(v -> skipSegment());
        nextButton = pill("Next episode");
        nextButton.setOnClickListener(v -> finishWith("next", null));
        LinearLayout.LayoutParams gap = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        gap.leftMargin = dp(12);
        actions.addView(skipButton);
        actions.addView(nextButton, gap);
        root.addView(actions, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM | Gravity.END));

        setContentView(root);
    }

    private void hideSystemBars() {
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            if (getWindow().getInsetsController() != null) getWindow().getInsetsController().hide(WindowInsets.Type.systemBars());
        } else {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        }
    }

    private void readSegments() {
        JSONArray list = request.optJSONArray("segments");
        for (int i = 0; list != null && i < list.length(); i++) {
            JSONObject s = list.optJSONObject(i);
            if (s == null) continue;
            segments.add(new double[] {s.optDouble("start"), s.optDouble("end")});
            segmentTypes.add(s.optString("type", "Intro"));
        }
        if (request.has("next") && request.has("upNextAt")) {
            upNextAt = request.optDouble("upNextAt", -1);
            JSONObject next = request.optJSONObject("next");
            if (next != null) nextButton.setText("Next: " + next.optString("title"));
        }
    }

    // ---- playback ------------------------------------------------------------------------

    private void startPlayer() {
        DefaultRenderersFactory renderers = new DefaultRenderersFactory(this).setEnableDecoderFallback(true);
        player = new ExoPlayer.Builder(this, renderers)
                .setSeekBackIncrementMs(10_000)
                .setSeekForwardIncrementMs(10_000)
                .build();
        player.setVideoChangeFrameRateStrategy(C.VIDEO_CHANGE_FRAME_RATE_STRATEGY_OFF);
        view.setPlayer(player);

        MediaItem.Builder item = new MediaItem.Builder().setUri(Uri.parse(request.optString("url")));
        if ("Transcode".equals(request.optString("method"))) item.setMimeType(MimeTypes.APPLICATION_M3U8);
        JSONArray subs = request.optJSONArray("subtitles");
        List<MediaItem.SubtitleConfiguration> sidecars = new ArrayList<>();
        for (int i = 0; subs != null && i < subs.length(); i++) {
            JSONObject s = subs.optJSONObject(i);
            if (s == null) continue;
            sidecars.add(new MediaItem.SubtitleConfiguration.Builder(Uri.parse(s.optString("url")))
                    .setId("ext-" + s.optInt("index"))
                    .setMimeType(s.optString("mime"))
                    .setLanguage(s.optString("language", null))
                    .setLabel(s.optString("label"))
                    .build());
        }
        item.setSubtitleConfigurations(sidecars);

        player.addListener(new Player.Listener() {
            @Override
            public void onTracksChanged(Tracks tracks) {
                if (!tracksApplied && !tracks.getGroups().isEmpty()) {
                    tracksApplied = true;
                    applyInitialTracks(tracks);
                    matchFrameRate(tracks);
                }
                sendState(true);
            }

            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                sendState(true);
            }

            @Override
            public void onPlaybackStateChanged(int state) {
                if (state == Player.STATE_ENDED) finishWith("ended", null);
            }

            @Override
            public void onPlayerError(PlaybackException error) {
                finishWith("error", error.getErrorCodeName() + (error.getMessage() != null ? ": " + error.getMessage() : ""));
            }
        });

        player.setMediaItem(item.build(), Math.round(request.optDouble("startSeconds", 0) * 1000));
        player.prepare();
        player.setPlayWhenReady(true);
    }

    /** Groups of one track type, in the order the file lists them. */
    private static List<Tracks.Group> groups(Tracks tracks, int type) {
        List<Tracks.Group> out = new ArrayList<>();
        for (Tracks.Group g : tracks.getGroups()) if (g.getType() == type) out.add(g);
        return out;
    }

    private static boolean isSidecar(Tracks.Group g) {
        String id = g.getTrackFormat(0).id;
        return id != null && id.contains("ext-");
    }

    private void applyInitialTracks(Tracks tracks) {
        TrackSelectionParameters.Builder p = player.getTrackSelectionParameters().buildUpon();
        boolean direct = !"Transcode".equals(request.optString("method"));

        JSONObject audio = request.optJSONObject("audio");
        List<Tracks.Group> audioGroups = groups(tracks, C.TRACK_TYPE_AUDIO);
        if (direct && audio != null) {
            int ordinal = audio.optInt("ordinal", 0);
            if (ordinal >= 0 && ordinal < audioGroups.size()) {
                p.setOverrideForType(new TrackSelectionOverride(audioGroups.get(ordinal).getMediaTrackGroup(), 0));
            }
        }

        JSONObject choice = request.optJSONObject("subtitleChoice");
        String kind = choice == null ? "off" : choice.optString("kind", "off");
        List<Tracks.Group> text = groups(tracks, C.TRACK_TYPE_TEXT);
        List<Tracks.Group> embedded = new ArrayList<>();
        Tracks.Group chosen = null;
        for (Tracks.Group g : text) if (!isSidecar(g)) embedded.add(g);
        if ("embedded".equals(kind)) {
            int ordinal = choice.optInt("ordinal", -1);
            if (ordinal >= 0 && ordinal < embedded.size()) chosen = embedded.get(ordinal);
        } else if ("external".equals(kind)) {
            String id = "ext-" + choice.optInt("index");
            for (Tracks.Group g : text) {
                String fid = g.getTrackFormat(0).id;
                if (fid != null && fid.contains(id)) chosen = g;
            }
        }
        if (chosen != null) {
            p.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false);
            p.setOverrideForType(new TrackSelectionOverride(chosen.getMediaTrackGroup(), 0));
        } else {
            p.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true);
        }
        player.setTrackSelectionParameters(p.build());
    }

    /**
     * Switches the display to a mode whose refresh rate fits the video (24p film on a
     * 24 Hz or 48 Hz mode), at the same resolution, so motion doesn't judder.
     */
    private void matchFrameRate(Tracks tracks) {
        if (!request.optBoolean("matchFrameRate", true)) return;
        float fps = (float) request.optDouble("frameRate", 0);
        for (Tracks.Group g : groups(tracks, C.TRACK_TYPE_VIDEO)) {
            Format f = g.getTrackFormat(0);
            if (f.frameRate > 0) fps = f.frameRate;
        }
        if (fps < 10) return;
        Display display = getWindowManager().getDefaultDisplay();
        Display.Mode now = display.getMode();
        Display.Mode best = null;
        float bestScore = Float.MAX_VALUE;
        for (Display.Mode m : display.getSupportedModes()) {
            if (m.getPhysicalWidth() != now.getPhysicalWidth() || m.getPhysicalHeight() != now.getPhysicalHeight()) continue;
            float rate = m.getRefreshRate();
            float multiple = Math.round(rate / fps);
            if (multiple < 1 || multiple > 5) continue;
            float error = Math.abs(rate - fps * multiple) / multiple;
            if (error > 0.06f) continue;
            // Exact rates first (23.976 over 24), then the lowest multiple.
            float score = error * 100 + multiple;
            if (score < bestScore) {
                bestScore = score;
                best = m;
            }
        }
        if (best == null || best.getModeId() == now.getModeId()) return;
        WindowManager.LayoutParams lp = getWindow().getAttributes();
        lp.preferredDisplayModeId = best.getModeId();
        getWindow().setAttributes(lp);
    }

    // ---- skip, up next, state ----------------------------------------------------------------

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            if (player == null || finished) return;
            double t = player.getCurrentPosition() / 1000.0;
            int active = -1;
            for (int i = 0; i < segments.size(); i++) {
                double[] s = segments.get(i);
                if (t >= s[0] && t < s[1] - 1) active = i;
            }
            if (active >= 0) {
                String type = segmentTypes.get(active);
                skipButton.setText("Commercial".equals(type) ? "Skip ad" : "Skip " + type.toLowerCase());
                showAction(skipButton);
            } else skipButton.setVisibility(View.GONE);
            if (upNextAt >= 0 && t >= upNextAt) showAction(nextButton);
            else nextButton.setVisibility(View.GONE);
            sendState(false);
            handler.postDelayed(this, TICK_MS);
        }
    };

    /** An action button takes focus when it appears with the controls hidden, so OK presses it. */
    private void showAction(Button b) {
        if (b.getVisibility() == View.VISIBLE) return;
        b.setVisibility(View.VISIBLE);
        if (!view.isControllerFullyVisible()) b.requestFocus();
    }

    private void skipSegment() {
        double t = player.getCurrentPosition() / 1000.0;
        for (double[] s : segments) {
            if (t >= s[0] && t < s[1]) {
                player.seekTo(Math.round(s[1] * 1000));
                break;
            }
        }
        skipButton.setVisibility(View.GONE);
        view.requestFocus();
    }

    private JSONObject state() throws JSONException {
        JSONObject s = new JSONObject()
                .put("position", player.getCurrentPosition() / 1000.0)
                .put("paused", !player.getPlayWhenReady())
                .put("buffering", player.getPlaybackState() == Player.STATE_BUFFERING);
        Tracks tracks = player.getCurrentTracks();
        List<Tracks.Group> audio = groups(tracks, C.TRACK_TYPE_AUDIO);
        for (int i = 0; i < audio.size(); i++) if (audio.get(i).isSelected()) s.put("audioOrdinal", i);
        int ordinal = -1;
        int embeddedIndex = 0;
        for (Tracks.Group g : groups(tracks, C.TRACK_TYPE_TEXT)) {
            if (isSidecar(g)) {
                if (g.isSelected()) {
                    String id = g.getTrackFormat(0).id;
                    try {
                        s.put("externalSubtitle", Integer.parseInt(id.substring(id.indexOf("ext-") + 4)));
                    } catch (NumberFormatException ignored) {
                        // not one of ours
                    }
                }
                continue;
            }
            if (g.isSelected()) ordinal = embeddedIndex;
            embeddedIndex++;
        }
        if (!s.has("externalSubtitle")) s.put("subtitleOrdinal", ordinal);
        return s;
    }

    private void sendState(boolean force) {
        if (player == null || finished) return;
        boolean paused = !player.getPlayWhenReady();
        long now = System.currentTimeMillis();
        if (!force && paused == lastPaused && now - lastStateAt < STATE_EVERY_MS) return;
        lastPaused = paused;
        lastStateAt = now;
        try {
            MainActivity.sendEvent(state().put("type", "state"));
        } catch (JSONException ignored) {
            // nothing to send
        }
    }

    private void finishWith(String reason, String error) {
        if (finished) return;
        finished = true;
        handler.removeCallbacksAndMessages(null);
        try {
            JSONObject result = player != null ? state() : new JSONObject().put("position", request != null ? request.optDouble("startSeconds", 0) : 0).put("paused", true);
            result.put("type", "result").put("reason", reason).put("interacted", interacted);
            if (error != null) result.put("error", error);
            MainActivity.sendEvent(result);
        } catch (JSONException ignored) {
            // the page treats a missing result as stopped
        }
        finish();
    }

    // ---- input ---------------------------------------------------------------------------

    @Override
    public void onUserInteraction() {
        super.onUserInteraction();
        // The first moments are the remote's OK that started playback.
        if (System.currentTimeMillis() - startedAt > 5000) interacted = true;
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (event.getAction() == KeyEvent.ACTION_DOWN) {
            switch (event.getKeyCode()) {
                case KeyEvent.KEYCODE_MEDIA_NEXT:
                    if (request.has("next")) finishWith("next", null);
                    return true;
                case KeyEvent.KEYCODE_MEDIA_PREVIOUS:
                    if (request.optBoolean("hasPrevious")) finishWith("previous", null);
                    return true;
                case KeyEvent.KEYCODE_MEDIA_STOP:
                    finishWith("stopped", null);
                    return true;
                default:
                    break;
            }
        }
        // D-pad and media keys show and drive the controls; focused buttons get the rest.
        View focused = getCurrentFocus();
        if (focused instanceof Button && (focused == skipButton || focused == nextButton)) return super.dispatchKeyEvent(event);
        return view.dispatchKeyEvent(event) || super.dispatchKeyEvent(event);
    }

    private void back() {
        if (view.isControllerFullyVisible()) view.hideController();
        else finishWith("stopped", null);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        back(); // Android 12 and earlier
    }

    /** Remote control from the page: a PlayerCommand (src/features/player/commands.ts). */
    void control(JSONObject c) {
        if (player == null || finished) return;
        switch (c.optString("kind")) {
            case "toggle":
                player.setPlayWhenReady(!player.getPlayWhenReady());
                break;
            case "pause":
                player.setPlayWhenReady(false);
                break;
            case "unpause":
                player.setPlayWhenReady(true);
                break;
            case "seek":
                player.seekTo(Math.round(c.optDouble("seconds", 0) * 1000));
                break;
            case "seekBy":
                player.seekTo(Math.max(0, player.getCurrentPosition() + Math.round(c.optDouble("seconds", 0) * 1000)));
                break;
            case "volume":
                player.setVolume((float) Math.max(0, Math.min(1, c.optDouble("value", 1))));
                break;
            case "mute":
                player.setVolume(c.has("muted") ? (c.optBoolean("muted") ? 0f : 1f) : (player.getVolume() > 0 ? 0f : 1f));
                break;
            case "next":
                finishWith("next", null);
                break;
            case "previous":
                finishWith("previous", null);
                break;
            case "stop":
                finishWith("stopped", null);
                break;
            default:
                break;
        }
        sendState(true);
    }

    @Override
    protected void onStop() {
        super.onStop();
        // Home, or another app on top: pause rather than play to an empty room.
        if (player != null && !finished) player.setPlayWhenReady(false);
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (!finished && request != null) finishWith("stopped", null);
        if (player != null) {
            player.release();
            player = null;
        }
        if (current.get() == this) current = new WeakReference<>(null);
        super.onDestroy();
    }
}
