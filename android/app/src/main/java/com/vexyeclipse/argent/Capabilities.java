package com.vexyeclipse.argent;

import android.app.Activity;
import android.media.MediaCodecInfo;
import android.media.MediaCodecList;
import android.os.Build;
import android.view.Display;

import androidx.annotation.OptIn;
import androidx.media3.common.C;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.audio.AudioCapabilities;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.Locale;
import java.util.TreeSet;

/**
 * What this device can play, for the web app's device profile (NativeCapabilities in
 * src/platform/android.ts): its video and audio decoders, the HDR formats its display
 * shows, and the surround formats it can pass through to a receiver over HDMI.
 */
final class Capabilities {
    private Capabilities() {}

    @OptIn(markerClass = UnstableApi.class)
    @SuppressWarnings("deprecation")
    static String probe(Activity activity, boolean tv) {
        MediaCodecInfo[] codecs = new MediaCodecList(MediaCodecList.REGULAR_CODECS).getCodecInfos();
        AudioCapabilities audio = AudioCapabilities.getCapabilities(activity);
        Display display = activity.getWindowManager().getDefaultDisplay();
        try {
            JSONObject video = new JSONObject()
                    .put("h264", decodes(codecs, "video/avc"))
                    .put("hevc", decodes(codecs, "video/hevc"))
                    .put("hevc10", hevcMain10(codecs))
                    .put("av1", decodes(codecs, "video/av01"))
                    .put("vp9", decodes(codecs, "video/x-vnd.on2.vp9"))
                    .put("vp8", decodes(codecs, "video/x-vnd.on2.vp8"))
                    .put("mpeg2", decodes(codecs, "video/mpeg2"))
                    .put("vc1", decodes(codecs, "video/wvc1"));

            boolean hdr10 = false, hlg = false, dv = false, hdr10plus = false;
            Display.HdrCapabilities hdr = display.getHdrCapabilities();
            if (hdr != null) {
                for (int type : hdr.getSupportedHdrTypes()) {
                    if (type == Display.HdrCapabilities.HDR_TYPE_HDR10) hdr10 = true;
                    else if (type == Display.HdrCapabilities.HDR_TYPE_HLG) hlg = true;
                    else if (type == Display.HdrCapabilities.HDR_TYPE_DOLBY_VISION) dv = true;
                    else if (Build.VERSION.SDK_INT >= 29 && type == Display.HdrCapabilities.HDR_TYPE_HDR10_PLUS) hdr10plus = true;
                }
            }
            JSONObject hdrJson = new JSONObject()
                    .put("hdr10", hdr10)
                    .put("hlg", hlg)
                    // Dolby Vision needs the display and a Dolby Vision decoder.
                    .put("dolbyVision", dv && decodes(codecs, "video/dolby-vision"))
                    .put("hdr10plus", hdr10plus);

            boolean ac3Pass = audio.supportsEncoding(C.ENCODING_AC3);
            boolean eac3Pass = audio.supportsEncoding(C.ENCODING_E_AC3) || audio.supportsEncoding(C.ENCODING_E_AC3_JOC);
            boolean truehdPass = audio.supportsEncoding(C.ENCODING_DOLBY_TRUEHD);
            boolean dtsPass = audio.supportsEncoding(C.ENCODING_DTS);
            boolean dtshdPass = audio.supportsEncoding(C.ENCODING_DTS_HD);
            JSONObject passthrough = new JSONObject()
                    .put("ac3", ac3Pass)
                    .put("eac3", eac3Pass)
                    .put("truehd", truehdPass)
                    .put("dts", dtsPass)
                    .put("dtshd", dtshdPass);
            JSONObject audioJson = new JSONObject()
                    .put("aac", decodes(codecs, "audio/mp4a-latm"))
                    .put("mp3", decodes(codecs, "audio/mpeg"))
                    .put("opus", decodes(codecs, "audio/opus"))
                    .put("flac", decodes(codecs, "audio/flac"))
                    .put("vorbis", decodes(codecs, "audio/vorbis"))
                    .put("alac", decodes(codecs, "audio/alac"))
                    .put("ac3", ac3Pass || decodes(codecs, "audio/ac3"))
                    .put("eac3", eac3Pass || decodes(codecs, "audio/eac3"))
                    .put("truehd", truehdPass || decodes(codecs, "audio/true-hd"))
                    .put("dts", dtsPass || decodes(codecs, "audio/vnd.dts"))
                    .put("dtshd", dtshdPass || decodes(codecs, "audio/vnd.dts.hd"))
                    .put("pcm", true);

            Display.Mode mode = display.getMode();
            TreeSet<Float> rates = new TreeSet<>();
            for (Display.Mode m : display.getSupportedModes()) {
                if (m.getPhysicalWidth() == mode.getPhysicalWidth() && m.getPhysicalHeight() == mode.getPhysicalHeight()) {
                    rates.add(Math.round(m.getRefreshRate() * 1000f) / 1000f);
                }
            }
            JSONArray rateList = new JSONArray();
            for (Float r : rates.descendingSet()) rateList.put(r.doubleValue());

            return new JSONObject()
                    .put("sdk", Build.VERSION.SDK_INT)
                    .put("model", (Build.MANUFACTURER + " " + Build.MODEL).trim())
                    .put("tv", tv)
                    .put("video", video)
                    .put("hdr", hdrJson)
                    .put("audio", audioJson)
                    .put("passthrough", passthrough)
                    .put("maxChannels", Math.max(2, audio.getMaxChannelCount()))
                    .put("display", new JSONObject()
                            .put("width", mode.getPhysicalWidth())
                            .put("height", mode.getPhysicalHeight())
                            .put("refreshRates", rateList))
                    .toString();
        } catch (JSONException e) {
            return "{}";
        }
    }

    private static boolean decodes(MediaCodecInfo[] codecs, String mime) {
        for (MediaCodecInfo info : codecs) {
            if (info.isEncoder()) continue;
            for (String type : info.getSupportedTypes()) {
                if (type.toLowerCase(Locale.ROOT).equals(mime)) return true;
            }
        }
        return false;
    }

    private static boolean hevcMain10(MediaCodecInfo[] codecs) {
        for (MediaCodecInfo info : codecs) {
            if (info.isEncoder()) continue;
            for (String type : info.getSupportedTypes()) {
                if (!type.equalsIgnoreCase("video/hevc")) continue;
                try {
                    for (MediaCodecInfo.CodecProfileLevel pl : info.getCapabilitiesForType(type).profileLevels) {
                        if (pl.profile == MediaCodecInfo.CodecProfileLevel.HEVCProfileMain10
                                || pl.profile == MediaCodecInfo.CodecProfileLevel.HEVCProfileMain10HDR10) return true;
                    }
                } catch (IllegalArgumentException ignored) {
                    // A codec that lists a type it then won't describe.
                }
            }
        }
        return false;
    }
}
